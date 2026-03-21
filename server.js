require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const TOMORROW_API_KEY = process.env.TOMORROW_API_KEY;
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

function mapTomorrowCodeToWeatherCode(code) {
  const map = {
    1000: 0, 1100: 1, 1101: 2, 1102: 3, 1001: 3,
    2000: 45, 2100: 45,
    4000: 53, 4001: 63, 4200: 80, 4201: 63,
    5000: 73, 5001: 73, 5100: 73, 5101: 73,
    6000: 53, 6001: 63, 6200: 80, 6201: 63,
    7000: 45, 7101: 45, 7102: 45,
    8000: 95
  };
  return map[code] ?? 0;
}

function buildHourlyFromTomorrow(timelines) {
  return {
    time: timelines.map(item => item.time),
    temperature_2m: timelines.map(item => item.values?.temperature ?? null),
    humidity: timelines.map(item => item.values?.humidity ?? null),
    wind_kph: timelines.map(item => item.values?.windSpeed != null ? item.values.windSpeed * 3.6 : null),
    visibility: timelines.map(item => item.values?.visibility != null ? item.values.visibility * 1000 : null),
    precipitation_probability: timelines.map(item => item.values?.precipitationProbability ?? null),
    uv: timelines.map(item => item.values?.uvIndex ?? null),
    weather_code: timelines.map(item => mapTomorrowCodeToWeatherCode(item.values?.weatherCode)),
    wind_direction: timelines.map(item => item.values?.windDirection ?? null),
    pressure: timelines.map(item => item.values?.pressureSeaLevel ?? null),
    feels_like: timelines.map(item => item.values?.temperatureApparent ?? null)
  };
}

function buildDailyFromTomorrow(timelines) {
  return {
    time: timelines.map(item => item.time.split("T")[0]),
    temperature_2m_max: timelines.map(item => item.values?.temperatureMax ?? null),
    temperature_2m_min: timelines.map(item => item.values?.temperatureMin ?? null),
    precipitation_probability_max: timelines.map(item => item.values?.precipitationProbabilityMax ?? 0),
    uv_index_max: timelines.map(item => item.values?.uvIndexMax ?? 0),
    weather_code: timelines.map(item => mapTomorrowCodeToWeatherCode(item.values?.weatherCodeMax ?? item.values?.weatherCode))
  };
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

    // Tomorrow.io — PRIMARY
    const tomorrowUrl =
      `https://api.tomorrow.io/v4/weather/forecast?location=${location.lat},${location.lon}&apikey=${TOMORROW_API_KEY}&timesteps=1h,1d&units=metric`;

    // Open-Meteo — FALLBACK for hourly/daily + always used for weather_code & is_day
    const openMeteoForecastUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,wind_direction_10m,surface_pressure` +
      `&hourly=temperature_2m,relative_humidity_2m,weather_code,is_day,visibility,wind_speed_10m,precipitation_probability,uv_index` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max` +
      `&timezone=auto&forecast_days=7`;

    // WeatherAPI — supplementary
    const weatherApiUrl =
      `https://api.weatherapi.com/v1/forecast.json?key=${WEATHERAPI_KEY}&q=${location.lat},${location.lon}&days=7&aqi=yes&alerts=no`;

    // Air Quality
    const openMeteoAirUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${location.lat}&longitude=${location.lon}&hourly=pm2_5&timezone=auto`;

    // Historical
    const openMeteoHistoricalUrl =
      dayOfMonth > 1
        ? `https://archive-api.open-meteo.com/v1/archive?latitude=${location.lat}&longitude=${location.lon}&start_date=${monthStart}&end_date=${yesterday}&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto`
        : null;

    const [
      tomorrowData,
      openMeteoForecast,
      weatherApiData,
      openMeteoAir,
      openMeteoHistorical
    ] = await Promise.all([
      safelyFetch(tomorrowUrl, "Tomorrow.io"),
      safelyFetch(openMeteoForecastUrl, "OpenMeteo-Forecast"),
      safelyFetch(weatherApiUrl, "WeatherAPI"),
      safelyFetch(openMeteoAirUrl, "OpenMeteo-Air"),
      openMeteoHistoricalUrl ? safelyFetch(openMeteoHistoricalUrl, "OpenMeteo-Historical") : Promise.resolve(null)
    ]);

    // Log what Tomorrow.io actually returned
    const tomorrowHourlyRaw = tomorrowData?.timelines?.hourly || [];
    const tomorrowDailyRaw = tomorrowData?.timelines?.daily || [];
    console.log(`Tomorrow.io: ${tomorrowHourlyRaw.length} hourly, ${tomorrowDailyRaw.length} daily`);

    if (tomorrowHourlyRaw.length === 0 && tomorrowData) {
      console.log("Tomorrow.io response keys:", JSON.stringify(Object.keys(tomorrowData)));
      if (tomorrowData.timelines) {
        console.log("Tomorrow.io timelines keys:", JSON.stringify(Object.keys(tomorrowData.timelines)));
      }
      if (tomorrowData.code || tomorrowData.message || tomorrowData.type) {
        console.log("Tomorrow.io error:", JSON.stringify({ code: tomorrowData.code, message: tomorrowData.message, type: tomorrowData.type }));
      }
    }

    const tomorrowWorked = tomorrowHourlyRaw.length > 0;
    const tomorrowHourly = tomorrowWorked ? buildHourlyFromTomorrow(tomorrowHourlyRaw) : null;
    const tomorrowDaily = tomorrowDailyRaw.length > 0 ? buildDailyFromTomorrow(tomorrowDailyRaw) : null;

    // Open-Meteo parsed
    const omHourly = openMeteoForecast?.hourly || {};
    const omDaily = openMeteoForecast?.daily || {};
    const omCurrent = openMeteoForecast?.current || {};

    // WeatherAPI parsed
    const weatherApiForecastDays = weatherApiData?.forecast?.forecastday || [];
    const waSunrise = weatherApiForecastDays.map(day => `${day.date}T${convert12hTo24h(day.astro?.sunrise)}`);
    const waSunset = weatherApiForecastDays.map(day => `${day.date}T${convert12hTo24h(day.astro?.sunset)}`);
    const waUvMax = weatherApiForecastDays.map(day => day.day?.uv ?? 0);
    const waCurrent = weatherApiData?.current || {};

    // ── Build final hourly ──
    let finalHourly;
    let hourlySource;

    if (tomorrowWorked && tomorrowHourly) {
      hourlySource = "Tomorrow.io";

      // Use Open-Meteo weather_code and is_day (more accurate conditions)
      const omWeatherCodes = omHourly.weather_code || [];
      const omIsDayArr = omHourly.is_day || [];

      finalHourly = {
        time: tomorrowHourly.time,
        temperature_2m: tomorrowHourly.temperature_2m,
        weather_code: omWeatherCodes.length >= tomorrowHourly.time.length
          ? omWeatherCodes.slice(0, tomorrowHourly.time.length)
          : tomorrowHourly.weather_code,
        is_day: omIsDayArr.length >= tomorrowHourly.time.length
          ? omIsDayArr.slice(0, tomorrowHourly.time.length)
          : tomorrowHourly.time.map(() => 1),
        visibility: tomorrowHourly.visibility,
        humidity: tomorrowHourly.humidity,
        wind_kph: tomorrowHourly.wind_kph,
        precipitation_probability: tomorrowHourly.precipitation_probability,
        uv: tomorrowHourly.uv
      };
    } else if (omHourly.time?.length) {
      hourlySource = "Open-Meteo (fallback)";
      console.log("Using Open-Meteo as hourly fallback");

      finalHourly = {
        time: omHourly.time,
        temperature_2m: omHourly.temperature_2m || [],
        weather_code: omHourly.weather_code || [],
        is_day: omHourly.is_day || [],
        visibility: (omHourly.visibility || []).map(v => v != null ? v : null),
        humidity: omHourly.relative_humidity_2m || [],
        wind_kph: (omHourly.wind_speed_10m || []).map(v => v != null ? v : null),
        precipitation_probability: omHourly.precipitation_probability || [],
        uv: omHourly.uv_index || []
      };
    } else {
      hourlySource = "none";
      finalHourly = {
        time: [], temperature_2m: [], weather_code: [], is_day: [],
        visibility: [], humidity: [], wind_kph: [], precipitation_probability: [], uv: []
      };
    }

    // ── Build final daily ──
    let finalDaily;
    let dailySource;

    if (tomorrowDaily && tomorrowDailyRaw.length > 0) {
      dailySource = "Tomorrow.io";

      const omDailyWeatherCodes = omDaily.weather_code || [];
      const omSunrise = omDaily.sunrise || [];
      const omSunset = omDaily.sunset || [];

      finalDaily = {
        time: tomorrowDaily.time,
        weather_code: omDailyWeatherCodes.length >= tomorrowDaily.time.length
          ? omDailyWeatherCodes.slice(0, tomorrowDaily.time.length)
          : tomorrowDaily.weather_code,
        temperature_2m_max: tomorrowDaily.temperature_2m_max,
        temperature_2m_min: tomorrowDaily.temperature_2m_min,
        precipitation_probability_max: tomorrowDaily.precipitation_probability_max,
        sunrise: omSunrise.length ? omSunrise.slice(0, tomorrowDaily.time.length) : waSunrise.slice(0, tomorrowDaily.time.length),
        sunset: omSunset.length ? omSunset.slice(0, tomorrowDaily.time.length) : waSunset.slice(0, tomorrowDaily.time.length),
        uv_index_max: tomorrowDaily.uv_index_max.length ? tomorrowDaily.uv_index_max : waUvMax.slice(0, tomorrowDaily.time.length)
      };
    } else if (omDaily.time?.length) {
      dailySource = "Open-Meteo (fallback)";
      console.log("Using Open-Meteo as daily fallback");

      finalDaily = {
        time: omDaily.time,
        weather_code: omDaily.weather_code || [],
        temperature_2m_max: omDaily.temperature_2m_max || [],
        temperature_2m_min: omDaily.temperature_2m_min || [],
        precipitation_probability_max: omDaily.precipitation_probability_max || [],
        sunrise: omDaily.sunrise?.length ? omDaily.sunrise : waSunrise,
        sunset: omDaily.sunset?.length ? omDaily.sunset : waSunset,
        uv_index_max: omDaily.uv_index_max?.length ? omDaily.uv_index_max : waUvMax
      };
    } else {
      dailySource = "WeatherAPI (minimal)";
      finalDaily = {
        time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [],
        precipitation_probability_max: [], sunrise: waSunrise, sunset: waSunset, uv_index_max: waUvMax
      };
    }

    // ── Monthly ──
    const monthly = mergeMonthlyData(openMeteoHistorical, {
      time: finalDaily.time,
      weather_code: finalDaily.weather_code,
      temperature_2m_max: finalDaily.temperature_2m_max,
      temperature_2m_min: finalDaily.temperature_2m_min
    });

    // ── Current conditions ──
    const nearestHourlyIndex = findNearestIndex(finalHourly.time);
    const nearestAirIndex = findNearestIndex(openMeteoAir?.hourly?.time);

    // For current values, prefer Tomorrow.io hourly if it worked, then Open-Meteo current, then WeatherAPI
    const currentTemperature = firstAvailable(
      tomorrowWorked ? tomorrowHourly.temperature_2m?.[findNearestIndex(tomorrowHourly.time)] : null,
      omCurrent.temperature_2m,
      finalHourly.temperature_2m?.[nearestHourlyIndex],
      waCurrent.temp_c
    );

    const currentFeelsLike = firstAvailable(
      tomorrowWorked ? tomorrowHourly.feels_like?.[findNearestIndex(tomorrowHourly.time)] : null,
      omCurrent.apparent_temperature,
      waCurrent.feelslike_c
    );

    const currentHumidity = firstAvailable(
      finalHourly.humidity?.[nearestHourlyIndex],
      omCurrent.relative_humidity_2m,
      waCurrent.humidity
    );

    const currentWindKph = firstAvailable(
      finalHourly.wind_kph?.[nearestHourlyIndex],
      omCurrent.wind_speed_10m,
      waCurrent.wind_kph
    );

    const currentWindDeg = firstAvailable(
      tomorrowWorked ? tomorrowHourly.wind_direction?.[findNearestIndex(tomorrowHourly.time)] : null,
      omCurrent.wind_direction_10m,
      waCurrent.wind_degree
    );

    const currentPressure = firstAvailable(
      tomorrowWorked ? tomorrowHourly.pressure?.[findNearestIndex(tomorrowHourly.time)] : null,
      omCurrent.surface_pressure,
      waCurrent.pressure_mb
    );

    const currentIsDay = firstAvailable(
      omCurrent.is_day,
      finalHourly.is_day?.[nearestHourlyIndex],
      1
    );

    const currentWeatherCode = firstAvailable(
      omCurrent.weather_code,
      finalHourly.weather_code?.[nearestHourlyIndex],
      0
    );

    const currentUv = firstAvailable(
      finalHourly.uv?.[nearestHourlyIndex],
      waCurrent.uv
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
        tomorrowHourlyCount: tomorrowHourlyRaw.length,
        tomorrowDailyCount: tomorrowDailyRaw.length,
        openMeteoHourlyCount: omHourly.time?.length || 0,
        openMeteoDailyCount: omDaily.time?.length || 0,
        weatherApiDaysCount: weatherApiForecastDays.length,
        monthlyCount: monthly.length,
        hourlySource,
        dailySource,
        tomorrowError: (!tomorrowWorked && tomorrowData) ? (tomorrowData.message || tomorrowData.type || "empty timelines") : null
      },

      source: {
        hourly: hourlySource,
        daily: dailySource,
        conditions: "Open-Meteo",
        current: "Tomorrow.io > Open-Meteo > WeatherAPI",
        air_quality: "Open-Meteo Air + WeatherAPI",
        monthly: "Open-Meteo Archive + forecast merge"
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