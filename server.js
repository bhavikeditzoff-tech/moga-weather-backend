require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

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

function convert12hTo24h(time12h) {
  if (!time12h) return "00:00:00";
  const [time, modifier] = time12h.split(" ");
  let [hours, minutes] = time.split(":");
  if (hours === "12") hours = "00";
  if (modifier === "PM") hours = String(parseInt(hours, 10) + 12);
  return `${hours.padStart(2, "0")}:${minutes}:00`;
}

function safelyFetch(url, label) {
  return fetch(url)
    .then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => "no body");
        console.log(`${label} HTTP ${res.status}: ${text.substring(0, 300)}`);
        return null;
      }
      return res.json();
    })
    .catch((err) => {
      console.log(`${label} FETCH ERROR:`, err.message);
      return null;
    });
}

function mergeMonthlyData(historical, forecastDaily) {
  const map = {};
  const addDay = (date, code, max, min) => {
    map[date] = { date, weather_code: code, max_temp: max, min_temp: min };
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

  if (forecastDaily?.time?.length) {
    for (let i = 0; i < forecastDaily.time.length; i++) {
      addDay(
        forecastDaily.time[i],
        forecastDaily.weather_code?.[i] ?? 0,
        forecastDaily.temperature_2m_max?.[i] ?? null,
        forecastDaily.temperature_2m_min?.[i] ?? null
      );
    }
  }

  return Object.values(map).sort((a, b) => new Date(a.date) - new Date(b.date));
}

function findNearestIndex(timeArray) {
  if (!timeArray || !timeArray.length) return 0;
  const now = new Date();
  let idx = 0;
  let best = Infinity;
  for (let i = 0; i < timeArray.length; i++) {
    const t = new Date(timeArray[i]);
    const diff = Math.abs(now.getTime() - t.getTime());
    if (!isNaN(t.getTime()) && diff < best) {
      best = diff;
      idx = i;
    }
  }
  return idx;
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
    const dayOfMonth = now.getDate();
    const yesterday = `${year}-${month}-${String(Math.max(1, dayOfMonth - 1)).padStart(2, "0")}`;
    const monthStart = `${year}-${month}-01`;

    // Open-Meteo — PRIMARY for hourly temps, daily temps, weather codes, is_day, sunrise/sunset
    const openMeteoForecastUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}` +
      `&current=temperature_2m,weather_code,is_day` +
      `&hourly=temperature_2m,weather_code,is_day,visibility,precipitation_probability,uv_index` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max` +
      `&timezone=auto&forecast_days=7`;

    // WeatherAPI — PRIMARY for current conditions (humidity, feels like, wind, pressure, etc.)
    const weatherApiUrl =
      `https://api.weatherapi.com/v1/forecast.json?key=${WEATHERAPI_KEY}&q=${location.lat},${location.lon}&days=7&aqi=yes&alerts=no`;

    // Open-Meteo Air Quality
    const openMeteoAirUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${location.lat}&longitude=${location.lon}&hourly=pm2_5&timezone=auto`;

    // Open-Meteo Historical (monthly calendar)
    const openMeteoHistoricalUrl =
      dayOfMonth > 1
        ? `https://archive-api.open-meteo.com/v1/archive?latitude=${location.lat}&longitude=${location.lon}&start_date=${monthStart}&end_date=${yesterday}&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto`
        : null;

    const [
      openMeteoForecast,
      weatherApiData,
      openMeteoAir,
      openMeteoHistorical
    ] = await Promise.all([
      safelyFetch(openMeteoForecastUrl, "OpenMeteo-Forecast"),
      safelyFetch(weatherApiUrl, "WeatherAPI"),
      safelyFetch(openMeteoAirUrl, "OpenMeteo-Air"),
      openMeteoHistoricalUrl ? safelyFetch(openMeteoHistoricalUrl, "OpenMeteo-Historical") : Promise.resolve(null)
    ]);

    // ── Parse Open-Meteo ──
    const omHourly = openMeteoForecast?.hourly || {};
    const omDaily = openMeteoForecast?.daily || {};
    const omCurrent = openMeteoForecast?.current || {};

    // ── Parse WeatherAPI ──
    const waCurrent = weatherApiData?.current || {};
    const weatherApiForecastDays = weatherApiData?.forecast?.forecastday || [];
    const waSunrise = weatherApiForecastDays.map(day => `${day.date}T${convert12hTo24h(day.astro?.sunrise)}`);
    const waSunset = weatherApiForecastDays.map(day => `${day.date}T${convert12hTo24h(day.astro?.sunset)}`);

    console.log(`Open-Meteo: ${omHourly.time?.length || 0} hourly, ${omDaily.time?.length || 0} daily`);
    console.log(`WeatherAPI: current=${waCurrent.temp_c != null ? "yes" : "no"}, days=${weatherApiForecastDays.length}`);

    // ══════════════════════════════════════════
    //  HOURLY — Open-Meteo
    // ══════════════════════════════════════════
    const finalHourly = {
      time: omHourly.time || [],
      temperature_2m: omHourly.temperature_2m || [],
      weather_code: omHourly.weather_code || [],
      is_day: omHourly.is_day || [],
      visibility: (omHourly.visibility || []).map(v => v != null ? v : null),
      humidity: [],
      wind_kph: [],
      precipitation_probability: omHourly.precipitation_probability || [],
      uv: omHourly.uv_index || []
    };

    // Build hourly humidity & wind from WeatherAPI forecastday hours
    if (weatherApiForecastDays.length && omHourly.time?.length) {
      const waHourlyMap = {};
      for (const day of weatherApiForecastDays) {
        for (const hour of (day.hour || [])) {
          waHourlyMap[hour.time] = hour;
        }
      }

      for (const isoTime of omHourly.time) {
        const d = new Date(isoTime);
        const localKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:00`;
        const waHour = waHourlyMap[localKey];
        finalHourly.humidity.push(waHour?.humidity ?? null);
        finalHourly.wind_kph.push(waHour?.wind_kph ?? null);
      }
    }

    // ══════════════════════════════════════════
    //  DAILY — Open-Meteo temps + conditions
    // ══════════════════════════════════════════
    const finalDaily = {
      time: omDaily.time || [],
      weather_code: omDaily.weather_code || [],
      temperature_2m_max: omDaily.temperature_2m_max || [],
      temperature_2m_min: omDaily.temperature_2m_min || [],
      precipitation_probability_max: omDaily.precipitation_probability_max || [],
      sunrise: omDaily.sunrise?.length ? omDaily.sunrise : waSunrise,
      sunset: omDaily.sunset?.length ? omDaily.sunset : waSunset,
      uv_index_max: omDaily.uv_index_max || []
    };

    // ── Monthly ──
    const monthly = mergeMonthlyData(openMeteoHistorical, {
      time: finalDaily.time,
      weather_code: finalDaily.weather_code,
      temperature_2m_max: finalDaily.temperature_2m_max,
      temperature_2m_min: finalDaily.temperature_2m_min
    });

    // ══════════════════════════════════════════
    //  CURRENT CONDITIONS
    //  Temp/code/is_day → Open-Meteo
    //  Humidity/feels like/wind/pressure → WeatherAPI (station data)
    // ══════════════════════════════════════════
    const nearestHourlyIndex = findNearestIndex(finalHourly.time);
    const nearestAirIndex = findNearestIndex(openMeteoAir?.hourly?.time);

    const currentTemperature = firstAvailable(
      waCurrent.temp_c,
      omCurrent.temperature_2m,
      finalHourly.temperature_2m?.[nearestHourlyIndex]
    );

    // Feels like — WeatherAPI only (station-based, not model-exaggerated)
    const currentFeelsLike = firstAvailable(
      waCurrent.feelslike_c
    );

    // Humidity — WeatherAPI only (station-based)
    const currentHumidity = firstAvailable(
      waCurrent.humidity
    );

    // Wind — WeatherAPI (station-based)
    const currentWindKph = firstAvailable(
      waCurrent.wind_kph
    );

    const currentWindDeg = firstAvailable(
      waCurrent.wind_degree
    );

    const currentPressure = firstAvailable(
      waCurrent.pressure_mb
    );

    const currentIsDay = firstAvailable(
      omCurrent.is_day,
      finalHourly.is_day?.[nearestHourlyIndex],
      waCurrent.is_day,
      1
    );

    const currentWeatherCode = firstAvailable(
      omCurrent.weather_code,
      finalHourly.weather_code?.[nearestHourlyIndex],
      0
    );

    const currentUv = firstAvailable(
      waCurrent.uv,
      finalHourly.uv?.[nearestHourlyIndex]
    );

    const currentPm25 = firstAvailable(
      openMeteoAir?.hourly?.pm2_5?.[nearestAirIndex],
      waCurrent.air_quality?.pm2_5
    );

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
        temperature_c: currentTemperature,
        feelslike_c: currentFeelsLike,
        humidity: currentHumidity,
        wind_kph: currentWindKph,
        wind_degree: currentWindDeg,
        pressure_hpa: currentPressure,
        is_day: currentIsDay,
        weather_code: currentWeatherCode,
        condition_text: firstAvailable(waCurrent.condition?.text, null),
        uv: currentUv,
        air_quality_pm25: currentPm25
      },

      daily: finalDaily,
      hourly: finalHourly,
      monthly,

      debug: {
        openMeteoHourlyCount: omHourly.time?.length || 0,
        openMeteoDailyCount: omDaily.time?.length || 0,
        weatherApiCurrentOk: waCurrent.temp_c != null,
        weatherApiDaysCount: weatherApiForecastDays.length,
        monthlyCount: monthly.length
      },

      source: {
        hourly_temp: "Open-Meteo",
        hourly_conditions: "Open-Meteo",
        hourly_humidity_wind: "WeatherAPI (station hours)",
        daily: "Open-Meteo",
        current_temp: waCurrent.temp_c != null ? "WeatherAPI" : "Open-Meteo",
        current_humidity: "WeatherAPI (station)",
        current_feels_like: "WeatherAPI (station)",
        current_wind: "WeatherAPI (station)",
        current_pressure: "WeatherAPI (station)",
        conditions_code: "Open-Meteo",
        sunrise_sunset: "Open-Meteo",
        air_quality: "Open-Meteo Air → WeatherAPI",
        monthly: "Open-Meteo Archive + forecast"
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