require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const WEATHERAPI_KEY = process.env.WEATHERAPI_KEY;
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

function mapTomorrowCodeToWeatherCode(code) {
  const map = {
    1000: 0,   // clear
    1100: 1,   // mostly clear
    1101: 2,   // partly cloudy
    1102: 3,   // mostly cloudy
    1001: 3,   // cloudy
    2000: 45,  // fog
    2100: 45,  // light fog
    4000: 53,  // drizzle
    4001: 63,  // rain
    4200: 80,  // light rain
    4201: 63,  // heavy rain
    5000: 73,  // snow
    5001: 73,  // flurries
    5100: 73,  // light snow
    5101: 73,  // heavy snow
    6000: 53,  // freezing drizzle
    6001: 63,  // freezing rain
    6200: 80,  // light freezing rain
    6201: 63,  // heavy freezing rain
    7000: 45,  // ice pellets
    7101: 45,
    7102: 45,
    8000: 95   // thunderstorm
  };

  return map[code] ?? 0;
}

function convert12hTo24h(time12h) {
  if (!time12h) return "00:00:00";

  const [time, modifier] = time12h.split(" ");
  let [hours, minutes] = time.split(":");

  if (hours === "12") hours = "00";
  if (modifier === "PM") hours = String(parseInt(hours, 10) + 12);

  return `${hours.padStart(2, "0")}:${minutes}:00`;
}

function buildDailyFromTomorrow(dailyTimelines) {
  return {
    time: dailyTimelines.map(item => item.time.split("T")[0]),
    weather_code: dailyTimelines.map(item => mapTomorrowCodeToWeatherCode(item.values.weatherCodeMax ?? item.values.weatherCodeMin ?? 1000)),
    temperature_2m_max: dailyTimelines.map(item => item.values.temperatureMax ?? null),
    temperature_2m_min: dailyTimelines.map(item => item.values.temperatureMin ?? null),
    precipitation_probability_max: dailyTimelines.map(item => item.values.precipitationProbabilityMax ?? 0),
    sunrise: dailyTimelines.map(item => item.values.sunriseTime || null),
    sunset: dailyTimelines.map(item => item.values.sunsetTime || null),
    uv_index_max: dailyTimelines.map(item => item.values.uvIndexMax ?? 0)
  };
}

function buildHourlyFromTomorrow(hourlyTimelines) {
  return {
    time: hourlyTimelines.map(item => item.time),
    temperature_2m: hourlyTimelines.map(item => item.values.temperature ?? null),
    weather_code: hourlyTimelines.map(item => mapTomorrowCodeToWeatherCode(item.values.weatherCode ?? 1000)),
    is_day: hourlyTimelines.map(item => {
      const date = new Date(item.time);
      const hour = date.getHours();
      return hour >= 6 && hour < 18 ? 1 : 0;
    }),
    visibility: hourlyTimelines.map(item => item.values.visibility != null ? item.values.visibility * 1000 : null),
    humidity: hourlyTimelines.map(item => item.values.humidity ?? null),
    wind_kph: hourlyTimelines.map(item => item.values.windSpeed != null ? item.values.windSpeed * 3.6 : null)
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
      `https://api.tomorrow.io/v4/weather/forecast?location=${location.lat},${location.lon}&apikey=${TOMORROW_API_KEY}&timesteps=1h,1d&units=metric`;

    const weatherApiUrl =
      `https://api.weatherapi.com/v1/forecast.json?key=${WEATHERAPI_KEY}&q=${location.lat},${location.lon}&days=7&aqi=yes&alerts=no`;

    const openMeteoAirUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${location.lat}&longitude=${location.lon}&hourly=pm2_5&timezone=auto`;

    const openMeteoHistoricalUrl =
      `https://archive-api.open-meteo.com/v1/archive?latitude=${location.lat}&longitude=${location.lon}&start_date=${monthStart}&end_date=${yesterday}&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto`;

    const [
      tomorrowResponse,
      weatherApiResponse,
      openMeteoAirResponse,
      openMeteoHistoricalResponse
    ] = await Promise.all([
      fetch(tomorrowUrl),
      fetch(weatherApiUrl),
      fetch(openMeteoAirUrl),
      fetch(openMeteoHistoricalUrl)
    ]);

    const tomorrowData = await tomorrowResponse.json();
    const weatherApiData = await weatherApiResponse.json();
    const openMeteoAir = await openMeteoAirResponse.json();
    const openMeteoHistorical = await openMeteoHistoricalResponse.json();

    const hourlyTimelines = tomorrowData.timelines?.hourly || [];
    const dailyTimelines = tomorrowData.timelines?.daily || [];

    const mergedHourly = buildHourlyFromTomorrow(hourlyTimelines);
    const mergedDaily = buildDailyFromTomorrow(dailyTimelines);

    const nearestHourlyIndex = (() => {
      if (!mergedHourly.time.length) return 0;
      const now = new Date();
      let idx = 0;
      let best = Infinity;

      for (let i = 0; i < mergedHourly.time.length; i++) {
        const t = new Date(mergedHourly.time[i]);
        const diff = Math.abs(now.getTime() - t.getTime());
        if (!isNaN(t.getTime()) && diff < best) {
          best = diff;
          idx = i;
        }
      }
      return idx;
    })();

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

    const monthly = mergeMonthlyData(openMeteoHistorical, mergedDaily);

    const mergedData = {
      location: {
        key: location.key,
        name: firstAvailable(weatherApiData.location?.name, location.name),
        region: firstAvailable(weatherApiData.location?.region, location.region),
        country: firstAvailable(weatherApiData.location?.country, location.country),
        latitude: firstAvailable(weatherApiData.location?.lat, location.lat),
        longitude: firstAvailable(weatherApiData.location?.lon, location.lon)
      },

      current: {
        temperature_c: firstAvailable(
          mergedHourly.temperature_2m?.[nearestHourlyIndex],
          weatherApiData.current?.temp_c
        ),
        feelslike_c: firstAvailable(
          weatherApiData.current?.feelslike_c,
          mergedHourly.temperature_2m?.[nearestHourlyIndex]
        ),
        humidity: firstAvailable(
          mergedHourly.humidity?.[nearestHourlyIndex],
          weatherApiData.current?.humidity
        ),
        wind_kph: firstAvailable(
          mergedHourly.wind_kph?.[nearestHourlyIndex],
          weatherApiData.current?.wind_kph
        ),
        wind_degree: firstAvailable(
          weatherApiData.current?.wind_degree,
          null
        ),
        pressure_hpa: firstAvailable(
          weatherApiData.current?.pressure_mb,
          null
        ),
        is_day: firstAvailable(
          mergedHourly.is_day?.[nearestHourlyIndex],
          weatherApiData.current?.is_day
        ),
        weather_code: firstAvailable(
          mergedHourly.weather_code?.[nearestHourlyIndex],
          mapWeatherApiConditionToCode(weatherApiData.current?.condition?.text)
        ),
        condition_text: firstAvailable(
          weatherApiData.current?.condition?.text,
          null
        ),
        uv: firstAvailable(
          mergedDaily.uv_index_max?.[0],
          weatherApiData.current?.uv
        ),
        air_quality_pm25: firstAvailable(
          openMeteoAir.hourly?.pm2_5?.[nearestAirIndex],
          weatherApiData.current?.air_quality?.pm2_5
        )
      },

      daily: mergedDaily,
      hourly: mergedHourly,
      monthly,

      source: {
        primary_current: "Tomorrow.io",
        primary_hourly: "Tomorrow.io",
        primary_daily_temp: "Tomorrow.io",
        monthly_history: "Open-Meteo Archive + Tomorrow.io Merge",
        air_quality: "Open-Meteo Air + WeatherAPI"
      }
    };

    res.json(mergedData);
  } catch (error) {
    console.log("BACKEND ERROR:", error);
    res.status(500).json({ error: "Failed to fetch weather data" });
  }
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});