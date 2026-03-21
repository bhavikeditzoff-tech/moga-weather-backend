require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const WEATHERAPI_KEY = process.env.WEATHERAPI_KEY;

const PRESET_LOCATIONS = {
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

async function resolveLocation(query) {
  const requestedCity = (query.city || "").trim();
  const requestedCityKey = requestedCity.toLowerCase();

  const lat = query.lat != null ? Number(query.lat) : null;
  const lon = query.lon != null ? Number(query.lon) : null;

  if (lat != null && lon != null && !isNaN(lat) && !isNaN(lon)) {
    // Open-Meteo does NOT have a reverse geocoding endpoint.
    // Use the forward search with coordinates via WeatherAPI instead,
    // or simply pass coords through and let the caller provide the name.
    
    // Try WeatherAPI search for reverse geocoding
    const waSearchUrl = `https://api.weatherapi.com/v1/search.json?key=${WEATHERAPI_KEY}&q=${lat},${lon}`;
    const waResults = await safelyFetch(waSearchUrl, "WeatherAPI-ReverseGeo");
    
    if (waResults && waResults.length > 0) {
      const place = waResults[0];
      return {
        key: "coords",
        name: place.name || "Unknown location",
        region: place.region || "",
        country: place.country || "",
        lat,
        lon
      };
    }

    // Fallback: try Open-Meteo forward search with a nearby city approach
    // won't work well, so just return coords with no name
    return {
      key: "coords",
      name: "",  // Empty, so client-side name won't be overwritten
      region: "",
      country: "",
      lat,
      lon
    };
  }

  if (requestedCityKey && PRESET_LOCATIONS[requestedCityKey]) {
    return PRESET_LOCATIONS[requestedCityKey];
  }

  if (requestedCity) {
    const geoUrl =
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(requestedCity)}&count=1&language=en&format=json`;

    const geoData = await safelyFetch(geoUrl, "OpenMeteo-Geocoding");
    const place = geoData?.results?.[0];

    if (place) {
      return {
        key: requestedCityKey || "search",
        name: place.name || requestedCity,
        region: place.admin1 || place.admin2 || "",
        country: place.country || "",
        lat: place.latitude,
        lon: place.longitude
      };
    }
  }

  return PRESET_LOCATIONS.moga;
}
async function resolveIpLocation() {
  try {
    const geo = await safelyFetch("https://ipapi.co/json/", "IPAPI");
    if (!geo || !geo.latitude || !geo.longitude) {
      return PRESET_LOCATIONS.moga;
    }

    return {
      key: "ip",
      name: geo.city || "Unknown location",
      region: geo.region || "",
      country: geo.country_name || "",
      lat: Number(geo.latitude),
      lon: Number(geo.longitude)
    };
  } catch (err) {
    console.log("IP location resolve error:", err);
    return PRESET_LOCATIONS.moga;
  }
}

app.get("/", (req, res) => {
  res.send("RealWeather backend is running");
});

app.get("/api/search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.json({ results: [] });

    const geoUrl =
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=en&format=json`;

    const geoData = await safelyFetch(geoUrl, "OpenMeteo-Search");
    const results = (geoData?.results || []).map(item => ({
      name: item.name || "",
      region: item.admin1 || item.admin2 || "",
      country: item.country || "",
      latitude: item.latitude,
      longitude: item.longitude
    }));

    res.json({ results });
  } catch (error) {
    console.log("SEARCH ERROR:", error);
    res.status(500).json({ results: [] });
  }
});

app.get("/api/weather", async (req, res) => {
  try {
    let location;

    if (req.query.lat != null || req.query.lon != null || req.query.city) {
      location = await resolveLocation(req.query);
    } else {
      location = await resolveIpLocation();
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const dayOfMonth = now.getDate();
    const yesterday = `${year}-${month}-${String(Math.max(1, dayOfMonth - 1)).padStart(2, "0")}`;
    const monthStart = `${year}-${month}-01`;

    const openMeteoForecastUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}` +
      `&current=temperature_2m,weather_code,is_day` +
      `&hourly=temperature_2m,weather_code,is_day,visibility,precipitation_probability,uv_index` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max` +
      `&timezone=auto&forecast_days=7`;

    const weatherApiUrl =
      `https://api.weatherapi.com/v1/forecast.json?key=${WEATHERAPI_KEY}&q=${location.lat},${location.lon}&days=7&aqi=yes&alerts=no`;

    const openMeteoAirUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${location.lat}&longitude=${location.lon}&hourly=pm2_5&timezone=auto`;

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

    const omHourly = openMeteoForecast?.hourly || {};
    const omDaily = openMeteoForecast?.daily || {};
    const omCurrent = openMeteoForecast?.current || {};
    const omTimezone = openMeteoForecast?.timezone || "UTC";

    const waCurrent = weatherApiData?.current || {};
    const weatherApiForecastDays = weatherApiData?.forecast?.forecastday || [];
    const waSunrise = weatherApiForecastDays.map(day => `${day.date}T${convert12hTo24h(day.astro?.sunrise)}`);
    const waSunset = weatherApiForecastDays.map(day => `${day.date}T${convert12hTo24h(day.astro?.sunset)}`);

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

    if (weatherApiForecastDays.length && omHourly.time?.length) {
      const waHourlyMap = {};

      for (const day of weatherApiForecastDays) {
        for (const hour of (day.hour || [])) {
          waHourlyMap[hour.time] = hour;
        }
      }

      for (const isoTime of omHourly.time) {
        const d = new Date(isoTime);

        const localParts = new Intl.DateTimeFormat("en-CA", {
          timeZone: omTimezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          hourCycle: "h23"
        }).formatToParts(d);

        const year = localParts.find(p => p.type === "year")?.value;
        const month = localParts.find(p => p.type === "month")?.value;
        const day = localParts.find(p => p.type === "day")?.value;
        const hour = localParts.find(p => p.type === "hour")?.value;

        const localKey = `${year}-${month}-${day} ${hour}:00`;
        const waHour = waHourlyMap[localKey];

        finalHourly.humidity.push(waHour?.humidity ?? null);
        finalHourly.wind_kph.push(waHour?.wind_kph ?? null);
      }
    }

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

    const monthly = mergeMonthlyData(openMeteoHistorical, {
      time: finalDaily.time,
      weather_code: finalDaily.weather_code,
      temperature_2m_max: finalDaily.temperature_2m_max,
      temperature_2m_min: finalDaily.temperature_2m_min
    });

    const nearestHourlyIndex = findNearestIndex(finalHourly.time);
    const nearestAirIndex = findNearestIndex(openMeteoAir?.hourly?.time);

    const currentTemperature = firstAvailable(
      waCurrent.temp_c,
      omCurrent.temperature_2m,
      finalHourly.temperature_2m?.[nearestHourlyIndex]
    );

    const currentFeelsLike = firstAvailable(waCurrent.feelslike_c);
    const currentHumidity = firstAvailable(waCurrent.humidity);
    const currentWindKph = firstAvailable(waCurrent.wind_kph);
    const currentWindDeg = firstAvailable(waCurrent.wind_degree);
    const currentPressure = firstAvailable(waCurrent.pressure_mb);
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
      timezone: omTimezone,

      location: {
        key: location.key,
        name: location.name,
        region: location.region,
        country: location.country,
        latitude: location.lat,
        longitude: location.lon,
        timezone: omTimezone
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
        monthlyCount: monthly.length,
        locationResolved: location.name,
        timezone: omTimezone
      }
    });
  } catch (error) {
    console.log("BACKEND ERROR:", error);
    res.status(500).json({ error: "Failed to fetch weather data" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});