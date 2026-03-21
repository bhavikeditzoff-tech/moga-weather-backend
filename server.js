require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const VISUAL_CROSSING_API_KEY = process.env.VISUAL_CROSSING_API_KEY;
const WEATHERAPI_KEY = process.env.WEATHERAPI_KEY;

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

function mapVisualCrossingIconToCode(icon) {
  const text = (icon || "").toLowerCase();

  if (text.includes("clear-day") || text.includes("clear-night")) return 0;
  if (text.includes("partly-cloudy")) return 2;
  if (text.includes("cloudy")) return 3;
  if (text.includes("fog")) return 45;
  if (text.includes("rain")) return 63;
  if (text.includes("showers")) return 80;
  if (text.includes("snow")) return 73;
  if (text.includes("thunder")) return 95;

  return 0;
}

function convertWeatherApiSunTime(date, time12h) {
  if (!time12h) return null;

  const [time, modifier] = time12h.split(" ");
  let [hours, minutes] = time.split(":");

  if (hours === "12") hours = "00";
  if (modifier === "PM") hours = String(parseInt(hours, 10) + 12);

  return `${date}T${hours.padStart(2, "0")}:${minutes}:00`;
}

function buildFromVisualCrossing(vcData) {
  const days = vcData.days || [];

  const currentConditions = vcData.currentConditions || {};

  const daily = {
    time: days.map(day => day.datetime),
    weather_code: days.map(day => mapVisualCrossingIconToCode(day.icon)),
    temperature_2m_max: days.map(day => day.tempmax ?? null),
    temperature_2m_min: days.map(day => day.tempmin ?? null),
    precipitation_probability_max: days.map(day => day.precipprob ?? 0),
    sunrise: days.map(day => day.sunrise ? `${day.datetime}T${day.sunrise}` : null),
    sunset: days.map(day => day.sunset ? `${day.datetime}T${day.sunset}` : null),
    uv_index_max: days.map(day => day.uvindex ?? 0)
  };

  const hourly = {
    time: [],
    temperature_2m: [],
    weather_code: [],
    is_day: [],
    visibility: [],
    humidity: [],
    wind_kph: []
  };

  days.forEach(day => {
    const hours = day.hours || [];
    hours.forEach(hour => {
      const timeString = `${day.datetime}T${hour.datetime}`;
      const hourNumber = Number(hour.datetime.split(":")[0]);

      hourly.time.push(timeString);
      hourly.temperature_2m.push(hour.temp ?? null);
      hourly.weather_code.push(mapVisualCrossingIconToCode(hour.icon));
      hourly.is_day.push(hourNumber >= 6 && hourNumber < 18 ? 1 : 0);
      hourly.visibility.push(hour.visibility != null ? hour.visibility * 1000 : null);
      hourly.humidity.push(hour.humidity ?? null);
      hourly.wind_kph.push(hour.windspeed != null ? hour.windspeed * 1.60934 : null);
    });
  });

  const current = {
    temperature_c: currentConditions.temp ?? null,
    feelslike_c: currentConditions.feelslike ?? null,
    humidity: currentConditions.humidity ?? null,
    wind_kph: currentConditions.windspeed != null ? currentConditions.windspeed * 1.60934 : null,
    wind_degree: currentConditions.winddir ?? null,
    pressure_hpa: currentConditions.pressure ?? null,
    is_day: currentConditions.icon?.includes("night") ? 0 : 1,
    weather_code: mapVisualCrossingIconToCode(currentConditions.icon),
    condition_text: currentConditions.conditions ?? null,
    uv: currentConditions.uvindex ?? null
  };

  return { current, hourly, daily };
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

    const vcUrl =
      `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${location.lat},${location.lon}?unitGroup=metric&include=current,hours,days&key=${VISUAL_CROSSING_API_KEY}&contentType=json`;

    const openMeteoAirUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${location.lat}&longitude=${location.lon}&hourly=pm2_5&timezone=auto`;

    const openMeteoHistoricalUrl =
      `https://archive-api.open-meteo.com/v1/archive?latitude=${location.lat}&longitude=${location.lon}&start_date=${monthStart}&end_date=${yesterday}&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto`;

    const [vcResponse, openMeteoAirResponse, openMeteoHistoricalResponse] = await Promise.all([
      fetch(vcUrl),
      fetch(openMeteoAirUrl),
      fetch(openMeteoHistoricalUrl)
    ]);

    const vcData = await vcResponse.json();
    const openMeteoAir = await openMeteoAirResponse.json();
    const openMeteoHistorical = await openMeteoHistoricalResponse.json();

    const parsed = buildFromVisualCrossing(vcData);

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

    const monthly = mergeMonthlyData(openMeteoHistorical, parsed.daily);

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
        temperature_c: parsed.current.temperature_c,
        feelslike_c: parsed.current.feelslike_c,
        humidity: parsed.current.humidity,
        wind_kph: parsed.current.wind_kph,
        wind_degree: parsed.current.wind_degree,
        pressure_hpa: parsed.current.pressure_hpa,
        is_day: parsed.current.is_day,
        weather_code: parsed.current.weather_code,
        condition_text: parsed.current.condition_text,
        uv: parsed.current.uv,
        air_quality_pm25: firstAvailable(openMeteoAir.hourly?.pm2_5?.[nearestAirIndex], null)
      },

      daily: parsed.daily,
      hourly: parsed.hourly,
      monthly,

      debug: {
        vcDays: parsed.daily.time.length,
        vcHours: parsed.hourly.time.length,
        vcCurrentLoaded: parsed.current.temperature_c !== null,
        monthlyHistoricalCount: openMeteoHistorical.daily?.time?.length || 0
      },

      source: {
        primary_current_temp: "Visual Crossing",
        primary_current_condition: "Visual Crossing",
        primary_hourly: "Visual Crossing",
        primary_daily_temp: "Visual Crossing",
        primary_daily_condition: "Visual Crossing",
        primary_uv: "Visual Crossing",
        monthly_history: "Open-Meteo Archive + Visual Crossing Merge",
        air_quality: "Open-Meteo Air"
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