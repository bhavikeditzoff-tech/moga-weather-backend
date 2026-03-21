require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const WEATHERAPI_KEY = process.env.WEATHERAPI_KEY;
const ACCUWEATHER_API_KEY = process.env.ACCUWEATHER_API_KEY;

const LOCATIONS = {
  moga: {
    key: "moga",
    name: "Moga",
    region: "Punjab",
    country: "India",
    lat: 30.8165,
    lon: 75.1717,
    accuweatherLocationKey: "190065"
  },
  ludhiana: {
    key: "ludhiana",
    name: "Ludhiana",
    region: "Punjab",
    country: "India",
    lat: 30.9000,
    lon: 75.8573,
    accuweatherLocationKey: null
  }
};

function firstAvailable(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && !Number.isNaN(value)) return value;
  }
  return null;
}

function convert12hTo24h(time12h) {
  if (!time12h) return "00:00:00";

  const [time, modifier] = time12h.split(" ");
  let [hours, minutes] = time.split(":");

  if (hours === "12") hours = "00";
  if (modifier === "PM") hours = String(parseInt(hours, 10) + 12);

  return `${hours.padStart(2, "0")}:${minutes}:00`;
}

function mapWeatherApiConditionToCode(text) {
  const lower = (text || "").toLowerCase();

  if (lower.includes("sunny") || lower.includes("clear")) return 0;
  if (lower.includes("partly cloudy")) return 2;
  if (lower.includes("cloudy")) return 3;
  if (lower.includes("overcast")) return 3;
  if (lower.includes("fog") || lower.includes("mist")) return 45;
  if (lower.includes("drizzle")) return 53;
  if (lower.includes("rain")) return 63;
  if (lower.includes("shower")) return 80;
  if (lower.includes("thunder")) return 95;
  if (lower.includes("snow")) return 73;

  return 0;
}

function mapAccuWeatherIconToCode(iconNumber) {
  const clear = [1, 2, 30, 33, 34];
  const partly = [3, 4, 5, 6, 35, 36, 37, 38];
  const cloudy = [7, 8];
  const fog = [11];
  const drizzle = [12];
  const rain = [13, 14, 18];
  const thunder = [15, 16, 17];
  const snow = [19, 20, 21, 22, 23, 24, 25, 26, 29];

  if (clear.includes(iconNumber)) return 0;
  if (partly.includes(iconNumber)) return 2;
  if (cloudy.includes(iconNumber)) return 3;
  if (fog.includes(iconNumber)) return 45;
  if (drizzle.includes(iconNumber)) return 53;
  if (rain.includes(iconNumber)) return 63;
  if (thunder.includes(iconNumber)) return 95;
  if (snow.includes(iconNumber)) return 73;

  return 0;
}

async function getAccuWeatherLocationKey(location) {
  if (location.accuweatherLocationKey) return location.accuweatherLocationKey;

  const url = `http://dataservice.accuweather.com/locations/v1/cities/geoposition/search?apikey=${ACCUWEATHER_API_KEY}&q=${location.lat},${location.lon}`;
  const res = await fetch(url);
  const data = await res.json();
  return data?.Key || null;
}

async function getAccuWeatherCurrent(locationKey) {
  const url = `http://dataservice.accuweather.com/currentconditions/v1/${locationKey}?apikey=${ACCUWEATHER_API_KEY}&details=true`;
  const res = await fetch(url);
  const data = await res.json();
  return Array.isArray(data) ? data[0] : null;
}

async function getAccuWeatherHourly(locationKey) {
  const url = `http://dataservice.accuweather.com/forecasts/v1/hourly/12hour/${locationKey}?apikey=${ACCUWEATHER_API_KEY}&details=true&metric=true`;
  const res = await fetch(url);
  const data = await res.json();
  return Array.isArray(data) ? data : null;
}

function buildCurrentFromAccuWeather(currentData) {
  if (!currentData) return null;

  return {
    temperature_c: currentData.Temperature?.Metric?.Value ?? null,
    feelslike_c: currentData.RealFeelTemperature?.Metric?.Value ?? null,
    humidity: currentData.RelativeHumidity ?? null,
    wind_kph: currentData.Wind?.Speed?.Metric?.Value ?? null,
    wind_degree: currentData.Wind?.Direction?.Degrees ?? null,
    pressure_hpa: currentData.Pressure?.Metric?.Value ?? null,
    is_day: currentData.IsDayTime ? 1 : 0,
    weather_code: mapAccuWeatherIconToCode(currentData.WeatherIcon),
    condition_text: currentData.WeatherText ?? null,
    uv: firstAvailable(currentData.UVIndexFloat, currentData.UVIndex)
  };
}

function buildHourlyFromAccuWeather(hourlyData) {
  if (!Array.isArray(hourlyData)) {
    return {
      time: [],
      temperature_2m: [],
      weather_code: [],
      is_day: [],
      visibility: [],
      humidity: [],
      wind_kph: [],
      precipitation_probability: [],
      uv: []
    };
  }

  return {
    time: hourlyData.map(item => item.DateTime),
    temperature_2m: hourlyData.map(item => item.Temperature?.Value ?? null),
    weather_code: hourlyData.map(item => mapAccuWeatherIconToCode(item.WeatherIcon)),
    is_day: hourlyData.map(item => item.IsDaylight ? 1 : 0),
    visibility: hourlyData.map(item => item.Visibility?.Value != null ? item.Visibility.Value * 1000 : null),
    humidity: hourlyData.map(item => item.RelativeHumidity ?? null),
    wind_kph: hourlyData.map(item => item.Wind?.Speed?.Value ?? null),
    precipitation_probability: hourlyData.map(item => item.PrecipitationProbability ?? null),
    uv: hourlyData.map(item => firstAvailable(item.UVIndexFloat, item.UVIndex))
  };
}

function buildDailyFromWeatherApi(weatherApiData) {
  const forecastDays = weatherApiData.forecast?.forecastday || [];

  return {
    time: forecastDays.map(day => day.date),
    weather_code: forecastDays.map(day => mapWeatherApiConditionToCode(day.day?.condition?.text)),
    temperature_2m_max: forecastDays.map(day => day.day?.maxtemp_c),
    temperature_2m_min: forecastDays.map(day => day.day?.mintemp_c),
    precipitation_probability_max: forecastDays.map(day => Number(day.day?.daily_chance_of_rain ?? 0)),
    sunrise: forecastDays.map(day => `${day.date}T${convert12hTo24h(day.astro?.sunrise)}`),
    sunset: forecastDays.map(day => `${day.date}T${convert12hTo24h(day.astro?.sunset)}`),
    uv_index_max: forecastDays.map(day => day.day?.uv ?? 0)
  };
}

function mergeMonthlyData(historical, forecast) {
  const map = {};

  const addDay = (date, code, max, min) => {
    map[date] = {
      date,
      weather_code: code,
      max_temp: max,
      min_temp: min
    };
  };

  if (historical?.daily?.time?.length) {
    for (let i = 0; i < historical.daily.time.length; i++) {
      addDay(
        historical.daily.time[i],
        historical.daily.weather_code?.[i] ?? 0,
        historical.daily.temperature_2m_max?.[i] ?? null,
        historical.daily.temperature_2m_min?.[i] ?? null
      );
    }
  }

  if (forecast?.time?.length) {
    for (let i = 0; i < forecast.time.length; i++) {
      addDay(
        forecast.time[i],
        forecast.weather_code?.[i] ?? 0,
        forecast.temperature_2m_max?.[i] ?? null,
        forecast.temperature_2m_min?.[i] ?? null
      );
    }
  }

  return Object.values(map).sort((a, b) => new Date(a.date) - new Date(b.date));
}

app.get("/", (req, res) => {
  res.send("Moga weather backend is running");
});

app.get("/api/weather", async (req, res) => {
  try {
    const requestedCity = (req.query.city || "moga").toLowerCase();
    const location = LOCATIONS[requestedCity] || LOCATIONS.moga;

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const yesterday = `${year}-${month}-${String(Math.max(1, now.getDate() - 1)).padStart(2, "0")}`;
    const monthStart = `${year}-${month}-01`;

    const locationKey = await getAccuWeatherLocationKey(location);

    const weatherApiUrl =
      `https://api.weatherapi.com/v1/forecast.json?key=${WEATHERAPI_KEY}&q=${location.lat},${location.lon}&days=7&aqi=yes&alerts=no`;

    const openMeteoAirUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${location.lat}&longitude=${location.lon}&hourly=pm2_5&timezone=auto`;

    const openMeteoHistoricalUrl =
      `https://archive-api.open-meteo.com/v1/archive?latitude=${location.lat}&longitude=${location.lon}&start_date=${monthStart}&end_date=${yesterday}&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto`;

    const [accuCurrentRaw, accuHourlyRaw, weatherApiData, openMeteoAir, openMeteoHistorical] = await Promise.all([
      getAccuWeatherCurrent(locationKey),
      getAccuWeatherHourly(locationKey),
      fetch(weatherApiUrl).then(r => r.json()),
      fetch(openMeteoAirUrl).then(r => r.json()),
      fetch(openMeteoHistoricalUrl).then(r => r.json())
    ]);

    const current = buildCurrentFromAccuWeather(accuCurrentRaw);
    const hourly = buildHourlyFromAccuWeather(accuHourlyRaw);
    const daily = buildDailyFromWeatherApi(weatherApiData);
    const monthly = mergeMonthlyData(openMeteoHistorical, daily);

    const nearestAirIndex = (() => {
      const arr = openMeteoAir.hourly?.time || [];
      if (!arr.length) return 0;
      const now = new Date();
      let idx = 0;
      let best = Infinity;

      for (let i = 0; i < arr.length; i++) {
        const t = new Date(arr[i]);
        const diff = Math.abs(now.getTime() - t.getTime());
        if (!isNaN(t.getTime()) && diff < best) {
          best = diff;
          idx = i;
        }
      }
      return idx;
    })();

    res.json({
      location: {
        key: location.key,
        name: firstAvailable(weatherApiData.location?.name, location.name),
        region: firstAvailable(weatherApiData.location?.region, location.region),
        country: firstAvailable(weatherApiData.location?.country, location.country),
        latitude: firstAvailable(weatherApiData.location?.lat, location.lat),
        longitude: firstAvailable(weatherApiData.location?.lon, location.lon)
      },

      current: {
        temperature_c: firstAvailable(current?.temperature_c, weatherApiData.current?.temp_c),
        feelslike_c: firstAvailable(current?.feelslike_c, weatherApiData.current?.feelslike_c),
        humidity: firstAvailable(current?.humidity, weatherApiData.current?.humidity),
        wind_kph: firstAvailable(current?.wind_kph, weatherApiData.current?.wind_kph),
        wind_degree: firstAvailable(current?.wind_degree, weatherApiData.current?.wind_degree),
        pressure_hpa: firstAvailable(current?.pressure_hpa, weatherApiData.current?.pressure_mb),
        is_day: firstAvailable(current?.is_day, weatherApiData.current?.is_day, 1),
        weather_code: firstAvailable(current?.weather_code, mapWeatherApiConditionToCode(weatherApiData.current?.condition?.text), 0),
        condition_text: firstAvailable(current?.condition_text, weatherApiData.current?.condition?.text),
        uv: firstAvailable(current?.uv, weatherApiData.current?.uv),
        air_quality_pm25: firstAvailable(openMeteoAir.hourly?.pm2_5?.[nearestAirIndex], weatherApiData.current?.air_quality?.pm2_5)
      },

      daily,
      hourly,
      monthly,

      debug: {
        accuweatherLocationKey: locationKey,
        accuweatherCurrentLoaded: !!accuCurrentRaw,
        accuweatherHourlyCount: Array.isArray(accuHourlyRaw) ? accuHourlyRaw.length : 0,
        weatherApiDailyCount: daily.time.length,
        monthlyHistoricalCount: openMeteoHistorical.daily?.time?.length || 0
      },

      source: {
        primary_current_temp: "AccuWeather",
        primary_current_condition: "AccuWeather",
        primary_hourly: "AccuWeather",
        primary_daily_temp: "WeatherAPI",
        primary_daily_condition: "WeatherAPI",
        primary_uv: "AccuWeather",
        monthly_history: "Open-Meteo Archive + WeatherAPI Merge",
        air_quality: "Open-Meteo Air + WeatherAPI"
      }
    });
  } catch (error) {
    console.log("BACKEND ERROR:", error);
    res.status(500).json({ error: "Failed to fetch weather data" });
  }
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});