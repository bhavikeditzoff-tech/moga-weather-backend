require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const WEATHERAPI_KEY = process.env.WEATHERAPI_KEY;
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const TOMORROW_API_KEY = process.env.TOMORROW_API_KEY;

const LOCATIONS = {
  moga: {
    key: "moga",
    name: "Moga",
    region: "Punjab",
    country: "India",
    lat: 30.8165,
    lon: 75.1717
  },
  ludhiana: {
    key: "ludhiana",
    name: "Ludhiana",
    region: "Punjab",
    country: "India",
    lat: 30.9000,
    lon: 75.8573
  }
};

function firstAvailable(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return null;
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

function mapTomorrowCodeToWeatherCode(code) {
  const map = {
    1000: 0,
    1100: 1,
    1101: 2,
    1102: 3,
    1001: 3,
    2000: 45,
    2100: 45,
    4000: 53,
    4001: 63,
    4200: 80,
    4201: 63,
    5000: 73,
    5001: 73,
    5100: 73,
    5101: 73,
    6000: 53,
    6001: 63,
    6200: 80,
    6201: 63,
    7000: 45,
    7101: 45,
    7102: 45,
    8000: 95
  };

  return map[code] ?? 0;
}

function mapOpenWeatherCodeToCode(id) {
  if (id >= 200 && id < 300) return 95;
  if (id >= 300 && id < 400) return 53;
  if (id >= 500 && id < 600) return 63;
  if (id >= 600 && id < 700) return 73;
  if (id === 701 || id === 741) return 45;
  if (id === 800) return 0;
  if (id === 801 || id === 802) return 2;
  if (id === 803 || id === 804) return 3;
  return 0;
}

function convert12hTo24h(time12h) {
  if (!time12h) return "00:00:00";

  const [time, modifier] = time12h.split(" ");
  let [hours, minutes] = time.split(":");

  if (hours === "12") hours = "00";
  if (modifier === "PM") hours = String(parseInt(hours, 10) + 12);

  return `${hours.padStart(2, "0")}:${minutes}:00`;
}

function buildHourlyFromOpenWeather(openWeatherData) {
  const hourly = {
    time: [],
    temperature_2m: [],
    weather_code: [],
    is_day: [],
    visibility: [],
    humidity: [],
    wind_kph: []
  };

  const list = openWeatherData.list || [];

  list.forEach(item => {
    if (!item.dt_txt) return;

    const time = item.dt_txt.replace(" ", "T");
    const hour = Number(time.split("T")[1]?.split(":")[0] ?? 12);

    hourly.time.push(time);
    hourly.temperature_2m.push(item.main?.temp ?? null);
    hourly.weather_code.push(mapOpenWeatherCodeToCode(item.weather?.[0]?.id));
    hourly.is_day.push(hour >= 6 && hour < 18 ? 1 : 0);
    hourly.visibility.push(item.visibility ?? null);
    hourly.humidity.push(item.main?.humidity ?? null);
    hourly.wind_kph.push(item.wind?.speed != null ? item.wind.speed * 3.6 : null);
  });

  return hourly;
}

function buildDailyFromTomorrow(dailyTimelines, weatherApiData) {
  const forecastDays = weatherApiData.forecast?.forecastday || [];

  const sunriseMap = {};
  const sunsetMap = {};
  const uvMap = {};

  forecastDays.forEach(day => {
    sunriseMap[day.date] = `${day.date}T${convert12hTo24h(day.astro?.sunrise)}`;
    sunsetMap[day.date] = `${day.date}T${convert12hTo24h(day.astro?.sunset)}`;
    uvMap[day.date] = day.day?.uv ?? 0;
  });

  return {
    time: dailyTimelines.map(day => day.time.split("T")[0]),
    weather_code: dailyTimelines.map(day => mapTomorrowCodeToWeatherCode(day.values?.weatherCodeMax ?? day.values?.weatherCodeMin ?? 1000)),
    temperature_2m_max: dailyTimelines.map(day => day.values?.temperatureMax ?? null),
    temperature_2m_min: dailyTimelines.map(day => day.values?.temperatureMin ?? null),
    precipitation_probability_max: dailyTimelines.map(day => day.values?.precipitationProbabilityMax ?? 0),
    sunrise: dailyTimelines.map(day => sunriseMap[day.time.split("T")[0]] ?? null),
    sunset: dailyTimelines.map(day => sunsetMap[day.time.split("T")[0]] ?? null),
    uv_index_max: dailyTimelines.map(day => uvMap[day.time.split("T")[0]] ?? day.values?.uvIndexMax ?? 0)
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

    const tomorrowUrl =
      `https://api.tomorrow.io/v4/weather/forecast?location=${location.lat},${location.lon}&apikey=${TOMORROW_API_KEY}&timesteps=1d&units=metric`;

    const weatherApiUrl =
      `https://api.weatherapi.com/v1/forecast.json?key=${WEATHERAPI_KEY}&q=${location.lat},${location.lon}&days=7&aqi=yes&alerts=no`;

    const openWeatherForecastUrl =
      `https://api.openweathermap.org/data/2.5/forecast?lat=${location.lat}&lon=${location.lon}&appid=${OPENWEATHER_API_KEY}&units=metric`;

    const openWeatherCurrentUrl =
      `https://api.openweathermap.org/data/2.5/weather?lat=${location.lat}&lon=${location.lon}&appid=${OPENWEATHER_API_KEY}&units=metric`;

    const openMeteoAirUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${location.lat}&longitude=${location.lon}&hourly=pm2_5&timezone=auto`;

    const openMeteoHistoricalUrl =
      `https://archive-api.open-meteo.com/v1/archive?latitude=${location.lat}&longitude=${location.lon}&start_date=${monthStart}&end_date=${yesterday}&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto`;

    const [
      tomorrowResponse,
      weatherApiResponse,
      openWeatherForecastResponse,
      openWeatherCurrentResponse,
      openMeteoAirResponse,
      openMeteoHistoricalResponse
    ] = await Promise.all([
      fetch(tomorrowUrl),
      fetch(weatherApiUrl),
      fetch(openWeatherForecastUrl),
      fetch(openWeatherCurrentUrl),
      fetch(openMeteoAirUrl),
      fetch(openMeteoHistoricalUrl)
    ]);

    const tomorrowData = await tomorrowResponse.json();
    const weatherApiData = await weatherApiResponse.json();
    const openWeatherForecast = await openWeatherForecastResponse.json();
    const openWeatherCurrent = await openWeatherCurrentResponse.json();
    const openMeteoAir = await openMeteoAirResponse.json();
    const openMeteoHistorical = await openMeteoHistoricalResponse.json();

    const tomorrowDaily = tomorrowData.timelines?.daily || [];
    const mergedDaily = buildDailyFromTomorrow(tomorrowDaily, weatherApiData);
    const mergedHourly = buildHourlyFromOpenWeather(openWeatherForecast);
    const monthly = mergeMonthlyData(openMeteoHistorical, mergedDaily);

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
        temperature_c: firstAvailable(openWeatherCurrent.main?.temp, weatherApiData.current?.temp_c),
        feelslike_c: firstAvailable(weatherApiData.current?.feelslike_c, openWeatherCurrent.main?.feels_like),
        humidity: firstAvailable(openWeatherCurrent.main?.humidity, weatherApiData.current?.humidity),
        wind_kph: firstAvailable(openWeatherCurrent.wind?.speed != null ? openWeatherCurrent.wind.speed * 3.6 : null, weatherApiData.current?.wind_kph),
        wind_degree: firstAvailable(openWeatherCurrent.wind?.deg, weatherApiData.current?.wind_degree),
        pressure_hpa: firstAvailable(openWeatherCurrent.main?.pressure, weatherApiData.current?.pressure_mb),
        is_day: firstAvailable(weatherApiData.current?.is_day, 1),
        weather_code: firstAvailable(mapOpenWeatherCodeToCode(openWeatherCurrent.weather?.[0]?.id), mapWeatherApiConditionToCode(weatherApiData.current?.condition?.text)),
        condition_text: firstAvailable(weatherApiData.current?.condition?.text, openWeatherCurrent.weather?.[0]?.main),
        uv: firstAvailable(weatherApiData.current?.uv, mergedDaily.uv_index_max?.[0]),
        air_quality_pm25: firstAvailable(openMeteoAir.hourly?.pm2_5?.[nearestAirIndex], weatherApiData.current?.air_quality?.pm2_5)
      },

      daily: mergedDaily,
      hourly: mergedHourly,
      monthly,

      debug: {
        tomorrowDailyCount: tomorrowDaily.length,
        openWeatherHourlyCount: mergedHourly.time.length
      },

      source: {
        primary_current: "OpenWeather",
        primary_hourly: "OpenWeather",
        primary_daily_temp: "Tomorrow.io",
        monthly_history: "Open-Meteo Archive + Tomorrow.io Merge",
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