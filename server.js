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
    wind_kph: hourlyTimelines.map(item => item.values.windSpeed != null ? item.values.windSpeed * 3.6 : null),
    precipitation_probability: hourlyTimelines.map(item => item.values.precipitationProbability ?? null),
    uv: hourlyTimelines.map(item => item.values.uvIndex ?? null)
  };
}

function buildDailyFromTomorrow(dailyTimelines) {
  return {
    time: dailyTimelines.map(item => item.time.split("T")[0]),
    weather_code: dailyTimelines.map(item => mapTomorrowCodeToWeatherCode(item.values.weatherCodeMax ?? item.values.weatherCodeMin ?? 1000)),
    temperature_2m_max: dailyTimelines.map(item => item.values.temperatureMax ?? null),
    temperature_2m_min: dailyTimelines.map(item => item.values.temperatureMin ?? null),
    precipitation_probability_max: dailyTimelines.map(item => item.values.precipitationProbabilityMax ?? 0),
    uv_index_max: dailyTimelines.map(item => item.values.uvIndexMax ?? 0)
  };
}

function buildDailyFromWeatherApi(weatherApiData) {
  const forecastDays = weatherApiData.forecast?.forecastday || [];

  return {
    time: forecastDays.map(day => day.date),
    sunrise: forecastDays.map(day => `${day.date}T${convert12hTo24h(day.astro?.sunrise)}`),
    sunset: forecastDays.map(day => `${day.date}T${convert12hTo24h(day.astro?.sunset)}`),
    uv_index_max: forecastDays.map(day => day.day?.uv ?? 0),
    condition_text: forecastDays.map(day => day.day?.condition?.text ?? "")
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

    const tomorrowHourlyRaw = tomorrowData.timelines?.hourly || [];
    const tomorrowDailyRaw = tomorrowData.timelines?.daily || [];

    const hourly = buildHourlyFromTomorrow(tomorrowHourlyRaw);
    const tomorrowDaily = buildDailyFromTomorrow(tomorrowDailyRaw);
    const weatherApiDaily = buildDailyFromWeatherApi(weatherApiData);

    const daily = {
      time: tomorrowDaily.time,
      weather_code: tomorrowDaily.weather_code,
      temperature_2m_max: tomorrowDaily.temperature_2m_max,
      temperature_2m_min: tomorrowDaily.temperature_2m_min,
      precipitation_probability_max: tomorrowDaily.precipitation_probability_max,
      sunrise: weatherApiDaily.sunrise,
      sunset: weatherApiDaily.sunset,
      uv_index_max: weatherApiDaily.uv_index_max?.length ? weatherApiDaily.uv_index_max : tomorrowDaily.uv_index_max
    };

    const monthly = mergeMonthlyData(openMeteoHistorical, daily);

    const nearestHourlyIndex = (() => {
      if (!hourly.time.length) return 0;
      const now = new Date();
      let idx = 0;
      let best = Infinity;

      for (let i = 0; i < hourly.time.length; i++) {
        const t = new Date(hourly.time[i]);
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

    res.json({
      location: {
        key: location.key,
        name: location.name,
        region: location.region,
        country: location.country,
        latitude: location.lat,
        longitude: location.lon
      },

      current: {
        temperature_c: firstAvailable(hourly.temperature_2m?.[nearestHourlyIndex], null),
        feelslike_c: firstAvailable(hourly.temperature_2m?.[nearestHourlyIndex], null),
        humidity: firstAvailable(hourly.humidity?.[nearestHourlyIndex], null),
        wind_kph: firstAvailable(hourly.wind_kph?.[nearestHourlyIndex], null),
        wind_degree: null,
        pressure_hpa: null,
        is_day: firstAvailable(hourly.is_day?.[nearestHourlyIndex], 1),
        weather_code: firstAvailable(hourly.weather_code?.[nearestHourlyIndex], 0),
        condition_text: firstAvailable(weatherApiData.current?.condition?.text, null),
        uv: firstAvailable(hourly.uv?.[nearestHourlyIndex], weatherApiData.current?.uv),
        air_quality_pm25: firstAvailable(openMeteoAir.hourly?.pm2_5?.[nearestAirIndex], weatherApiData.current?.air_quality?.pm2_5)
      },

      daily,
      hourly,
      monthly,

      debug: {
        tomorrowHourlyCount: hourly.time.length,
        tomorrowDailyCount: daily.time.length,
        monthlyHistoricalCount: openMeteoHistorical.daily?.time?.length || 0
      },

      source: {
        primary_current_temp: "Tomorrow.io",
        primary_current_condition: "Tomorrow.io",
        primary_hourly: "Tomorrow.io",
        primary_daily_temp: "Tomorrow.io",
        primary_daily_condition: "Tomorrow.io",
        primary_uv: "Tomorrow.io / WeatherAPI",
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