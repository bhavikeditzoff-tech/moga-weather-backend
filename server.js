require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const WEATHERAPI_KEY = process.env.WEATHERAPI_KEY;
const WEATHERBIT_API_KEY = process.env.WEATHERBIT_API_KEY;

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

function mapWeatherbitCodeToCode(code) {
  const map = {
    800: 0,
    801: 2,
    802: 3,
    803: 3,
    804: 3,
    700: 45,
    711: 45,
    721: 45,
    741: 45,
    500: 53,
    501: 63,
    502: 63,
    511: 63,
    520: 80,
    521: 80,
    522: 80,
    600: 73,
    601: 73,
    602: 73,
    610: 73,
    611: 73,
    612: 73,
    621: 73,
    622: 73,
    200: 95,
    201: 95,
    202: 95,
    230: 95,
    231: 95,
    232: 95
  };
  return map[code] ?? 0;
}

async function getWeatherbitCurrent(location) {
  const url = `https://api.weatherbit.io/v2.0/current?lat=${location.lat}&lon=${location.lon}&key=${WEATHERBIT_API_KEY}&units=M`;
  const res = await fetch(url);
  return await res.json();
}

async function getWeatherbitHourly(location) {
  const url = `https://api.weatherbit.io/v2.0/forecast/hourly?lat=${location.lat}&lon=${location.lon}&key=${WEATHERBIT_API_KEY}&hours=120&units=M`;
  const res = await fetch(url);
  return await res.json();
}

function buildCurrentFromWeatherbit(currentData) {
  const item = currentData?.data?.[0];
  if (!item) return null;

  return {
    temperature_c: item.temp ?? null,
    feelslike_c: item.app_temp ?? null,
    humidity: item.rh ?? null,
    wind_kph: item.wind_spd != null ? item.wind_spd * 3.6 : null,
    wind_degree: item.wind_dir ?? null,
    pressure_hpa: item.pres ?? null,
    is_day: item.pod === "d" ? 1 : 0,
    weather_code: mapWeatherbitCodeToCode(item.weather?.code),
    condition_text: item.weather?.description ?? null,
    uv: item.uv ?? null
  };
}

function buildHourlyFromWeatherbit(hourlyData) {
  const rows = hourlyData?.data || [];

  return {
    time: rows.map(item => item.timestamp_local?.replace(" ", "T")),
    temperature_2m: rows.map(item => item.temp ?? null),
    weather_code: rows.map(item => mapWeatherbitCodeToCode(item.weather?.code)),
    is_day: rows.map(item => {
      const hour = Number(item.timestamp_local?.split(" ")[1]?.split(":")[0] ?? 12);
      return hour >= 6 && hour < 18 ? 1 : 0;
    }),
    visibility: rows.map(item => item.vis != null ? item.vis * 1000 : null),
    humidity: rows.map(item => item.rh ?? null),
    wind_kph: rows.map(item => item.wind_spd != null ? item.wind_spd * 3.6 : null),
    precipitation_probability: rows.map(item => item.pop ?? null),
    uv: rows.map(item => item.uv ?? null)
  };
}

function buildDailyFromWeatherbit(hourlyData) {
  const rows = hourlyData?.data || [];
  const grouped = {};

  rows.forEach(item => {
    const date = item.timestamp_local?.split(" ")[0];
    if (!date) return;

    if (!grouped[date]) {
      grouped[date] = {
        temps: [],
        pops: [],
        codes: []
      };
    }

    if (item.temp !== undefined && item.temp !== null) grouped[date].temps.push(item.temp);
    if (item.pop !== undefined && item.pop !== null) grouped[date].pops.push(item.pop);
    if (item.weather?.code !== undefined && item.weather?.code !== null) grouped[date].codes.push(mapWeatherbitCodeToCode(item.weather.code));
  });

  const dates = Object.keys(grouped).sort();

  return {
    time: dates,
    weather_code: dates.map(d => grouped[d].codes[0] ?? 0),
    temperature_2m_max: dates.map(d => grouped[d].temps.length ? Math.max(...grouped[d].temps) : null),
    temperature_2m_min: dates.map(d => grouped[d].temps.length ? Math.min(...grouped[d].temps) : null),
    precipitation_probability_max: dates.map(d => grouped[d].pops.length ? Math.max(...grouped[d].pops) : 0)
  };
}

function buildDailyFromWeatherApi(weatherApiData) {
  const forecastDays = weatherApiData.forecast?.forecastday || [];

  return {
    time: forecastDays.map(day => day.date),
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

    const weatherApiUrl =
      `https://api.weatherapi.com/v1/forecast.json?key=${WEATHERAPI_KEY}&q=${location.lat},${location.lon}&days=7&aqi=yes&alerts=no`;

    const openMeteoAirUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${location.lat}&longitude=${location.lon}&hourly=pm2_5&timezone=auto`;

    const openMeteoHistoricalUrl =
      `https://archive-api.open-meteo.com/v1/archive?latitude=${location.lat}&longitude=${location.lon}&start_date=${monthStart}&end_date=${yesterday}&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto`;

    const [weatherbitCurrent, weatherbitHourly, weatherApiData, openMeteoAir, openMeteoHistorical] = await Promise.all([
      getWeatherbitCurrent(location),
      getWeatherbitHourly(location),
      fetch(weatherApiUrl).then(r => r.json()),
      fetch(openMeteoAirUrl).then(r => r.json()),
      fetch(openMeteoHistoricalUrl).then(r => r.json())
    ]);

    const current = buildCurrentFromWeatherbit(weatherbitCurrent);
    const hourly = buildHourlyFromWeatherbit(weatherbitHourly);
    const dailyFromWeatherbit = buildDailyFromWeatherbit(weatherbitHourly);
    const weatherApiDaily = buildDailyFromWeatherApi(weatherApiData);

    const daily = {
      time: dailyFromWeatherbit.time,
      weather_code: dailyFromWeatherbit.weather_code,
      temperature_2m_max: dailyFromWeatherbit.temperature_2m_max,
      temperature_2m_min: dailyFromWeatherbit.temperature_2m_min,
      precipitation_probability_max: dailyFromWeatherbit.precipitation_probability_max,
      sunrise: weatherApiDaily.sunrise,
      sunset: weatherApiDaily.sunset,
      uv_index_max: weatherApiDaily.uv_index_max
    };

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
        name: location.name,
        region: location.region,
        country: location.country,
        latitude: location.lat,
        longitude: location.lon
      },

      current: {
        temperature_c: firstAvailable(current?.temperature_c, null),
        feelslike_c: firstAvailable(current?.feelslike_c, null),
        humidity: firstAvailable(current?.humidity, null),
        wind_kph: firstAvailable(current?.wind_kph, null),
        wind_degree: firstAvailable(current?.wind_degree, null),
        pressure_hpa: firstAvailable(current?.pressure_hpa, null),
        is_day: firstAvailable(current?.is_day, 1),
        weather_code: firstAvailable(current?.weather_code, 0),
        condition_text: firstAvailable(current?.condition_text, null),
        uv: firstAvailable(current?.uv, weatherApiData.current?.uv),
        air_quality_pm25: firstAvailable(openMeteoAir.hourly?.pm2_5?.[nearestAirIndex], weatherApiData.current?.air_quality?.pm2_5)
      },

      daily,
      hourly,
      monthly,

      debug: {
        weatherbitCurrentLoaded: !!weatherbitCurrent?.data?.[0],
        weatherbitHourlyCount: hourly.time.length,
        weatherbitDailyCount: daily.time.length,
        monthlyHistoricalCount: openMeteoHistorical.daily?.time?.length || 0
      },

      source: {
        primary_current_temp: "Weatherbit",
        primary_current_condition: "Weatherbit",
        primary_hourly: "Weatherbit",
        primary_daily_temp: "Weatherbit",
        primary_daily_condition: "Weatherbit",
        primary_uv: "Weatherbit / WeatherAPI",
        monthly_history: "Open-Meteo Archive + Weatherbit Merge",
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