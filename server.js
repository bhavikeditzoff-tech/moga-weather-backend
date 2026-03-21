require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const WEATHERAPI_KEY = process.env.WEATHERAPI_KEY;

/* ───── IN-MEMORY CACHE ───── */

var cache = {};
var CACHE_DURATION = 10 * 60 * 1000;

function getCacheKey(lat, lon) {
  return Math.round(lat * 100) / 100 + "," + Math.round(lon * 100) / 100;
}

function getCached(key) {
  var entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.time > CACHE_DURATION) {
    delete cache[key];
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  var keys = Object.keys(cache);
  if (keys.length > 100) {
    delete cache[keys[0]];
  }
  cache[key] = { data: data, time: Date.now() };
}

/* ───── PRESET LOCATIONS ───── */

var PRESET_LOCATIONS = {
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

/* ───── HELPERS ───── */

function firstAvailable() {
  for (var i = 0; i < arguments.length; i++) {
    var value = arguments[i];
    if (value !== undefined && value !== null && !Number.isNaN(value)) return value;
  }
  return null;
}

function convert12hTo24h(time12h) {
  if (!time12h) return "00:00:00";
  var parts = time12h.split(" ");
  var time = parts[0];
  var modifier = parts[1];
  var timeParts = time.split(":");
  var hours = timeParts[0];
  var minutes = timeParts[1];
  if (hours === "12") hours = "00";
  if (modifier === "PM") hours = String(parseInt(hours, 10) + 12);
  return hours.padStart(2, "0") + ":" + minutes + ":00";
}

function safelyFetch(url, label) {
  return fetch(url)
    .then(function (res) {
      if (!res.ok) {
        return res.text().catch(function () { return "no body"; }).then(function (text) {
          console.log(label + " HTTP " + res.status + ": " + text.substring(0, 300));
          return null;
        });
      }
      return res.json();
    })
    .catch(function (err) {
      console.log(label + " FETCH ERROR: " + err.message);
      return null;
    });
}

function findNearestIndex(timeArray) {
  if (!timeArray || !timeArray.length) return 0;
  var now = new Date();
  var idx = 0;
  var best = Infinity;
  for (var i = 0; i < timeArray.length; i++) {
    var t = new Date(timeArray[i]);
    var diff = Math.abs(now.getTime() - t.getTime());
    if (!isNaN(t.getTime()) && diff < best) {
      best = diff;
      idx = i;
    }
  }
  return idx;
}

/* ───── WEATHERAPI CODE TO WMO ───── */

function weatherApiCodeToWMO(conditionCode) {
  var map = {
    1000: 0, 1003: 2, 1006: 3, 1009: 3, 1030: 45,
    1063: 61, 1066: 71, 1069: 66, 1072: 56, 1087: 95,
    1114: 73, 1117: 75, 1135: 45, 1147: 48,
    1150: 51, 1153: 51, 1168: 56, 1171: 57,
    1180: 61, 1183: 61, 1186: 63, 1189: 63,
    1192: 65, 1195: 65, 1198: 66, 1201: 67,
    1204: 66, 1207: 67,
    1210: 71, 1213: 71, 1216: 73, 1219: 73,
    1222: 75, 1225: 75, 1237: 77,
    1240: 80, 1243: 81, 1246: 82,
    1249: 85, 1252: 86, 1255: 85, 1258: 86,
    1261: 77, 1264: 77,
    1273: 95, 1276: 95, 1279: 95, 1282: 96
  };
  return map[conditionCode] !== undefined ? map[conditionCode] : 0;
}

/* ───── LOCATION RESOLVERS ───── */

async function resolveLocation(query) {
  var requestedCity = (query.city || "").trim();
  var requestedCityKey = requestedCity.toLowerCase();

  var lat = query.lat != null ? Number(query.lat) : null;
  var lon = query.lon != null ? Number(query.lon) : null;

  if (lat != null && lon != null && !isNaN(lat) && !isNaN(lon)) {
    var waSearchUrl = "https://api.weatherapi.com/v1/search.json?key=" + WEATHERAPI_KEY + "&q=" + lat + "," + lon;
    var waResults = await safelyFetch(waSearchUrl, "WeatherAPI-ReverseGeo");

    if (waResults && waResults.length > 0) {
      return {
        key: "coords",
        name: waResults[0].name || "Unknown location",
        region: waResults[0].region || "",
        country: waResults[0].country || "",
        lat: lat,
        lon: lon
      };
    }

    return { key: "coords", name: "", region: "", country: "", lat: lat, lon: lon };
  }

  if (requestedCityKey && PRESET_LOCATIONS[requestedCityKey]) {
    return PRESET_LOCATIONS[requestedCityKey];
  }

  if (requestedCity) {
    var geoUrl = "https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(requestedCity) + "&count=1&language=en&format=json";
    var geoData = await safelyFetch(geoUrl, "OpenMeteo-Geocoding");
    var place = geoData && geoData.results ? geoData.results[0] : null;

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

    // Fallback geocoding via WeatherAPI
    var waGeoUrl = "https://api.weatherapi.com/v1/search.json?key=" + WEATHERAPI_KEY + "&q=" + encodeURIComponent(requestedCity);
    var waGeoResults = await safelyFetch(waGeoUrl, "WeatherAPI-Geocoding");
    if (waGeoResults && waGeoResults.length > 0) {
      return {
        key: requestedCityKey || "search",
        name: waGeoResults[0].name || requestedCity,
        region: waGeoResults[0].region || "",
        country: waGeoResults[0].country || "",
        lat: waGeoResults[0].lat,
        lon: waGeoResults[0].lon
      };
    }
  }

  return PRESET_LOCATIONS.moga;
}

async function resolveIpLocation() {
  try {
    var geo = await safelyFetch("https://ipapi.co/json/", "IPAPI");
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
    return PRESET_LOCATIONS.moga;
  }
}

/* ───── FETCH HISTORICAL DATA FROM OPEN-METEO ───── */

async function fetchHistoricalData(location) {
  var now = new Date();
  var year = now.getFullYear();
  var month = String(now.getMonth() + 1).padStart(2, "0");
  var dayOfMonth = now.getDate();

  if (dayOfMonth <= 1) return null;

  var yesterday = year + "-" + month + "-" + String(dayOfMonth - 1).padStart(2, "0");
  var monthStart = year + "-" + month + "-01";

  var url = "https://archive-api.open-meteo.com/v1/archive?latitude=" + location.lat +
    "&longitude=" + location.lon +
    "&start_date=" + monthStart +
    "&end_date=" + yesterday +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto";

  var data = await safelyFetch(url, "OpenMeteo-Historical");
  return data;
}

/* ───── FETCH OPEN-METEO FORECAST ───── */

async function fetchOpenMeteoForecast(location) {
  var url = "https://api.open-meteo.com/v1/forecast?latitude=" + location.lat +
    "&longitude=" + location.lon +
    "&current=temperature_2m,weather_code,is_day" +
    "&hourly=temperature_2m,weather_code,is_day,visibility,precipitation_probability,uv_index" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max" +
    "&timezone=auto&forecast_days=7";

  var data = await safelyFetch(url, "OpenMeteo-Forecast");
  return data;
}

/* ───── FETCH OPEN-METEO AIR QUALITY ───── */

async function fetchOpenMeteoAir(location) {
  var url = "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=" + location.lat +
    "&longitude=" + location.lon +
    "&hourly=pm2_5&timezone=auto";

  var data = await safelyFetch(url, "OpenMeteo-Air");
  return data;
}

/* ───── FETCH WEATHERAPI DATA ───── */

async function fetchWeatherApiData(location) {
  var url = "https://api.weatherapi.com/v1/forecast.json?key=" + WEATHERAPI_KEY +
    "&q=" + location.lat + "," + location.lon +
    "&days=7&aqi=yes&alerts=no";

  var data = await safelyFetch(url, "WeatherAPI-Forecast");
  return data;
}

/* ───── BUILD MONTHLY DATA ───── */

function buildMonthlyData(historicalData, forecastDaily, waForecastDays) {
  var monthlyMap = {};

  // 1. Historical data from Open-Meteo (past dates)
  if (historicalData && historicalData.daily && historicalData.daily.time) {
    var hd = historicalData.daily;
    for (var i = 0; i < hd.time.length; i++) {
      monthlyMap[hd.time[i]] = {
        date: hd.time[i],
        weather_code: hd.weather_code ? hd.weather_code[i] : 0,
        max_temp: hd.temperature_2m_max ? hd.temperature_2m_max[i] : null,
        min_temp: hd.temperature_2m_min ? hd.temperature_2m_min[i] : null
      };
    }
  }

  // 2. Open-Meteo forecast daily (today + future)
  if (forecastDaily && forecastDaily.time) {
    for (var j = 0; j < forecastDaily.time.length; j++) {
      monthlyMap[forecastDaily.time[j]] = {
        date: forecastDaily.time[j],
        weather_code: forecastDaily.weather_code ? forecastDaily.weather_code[j] : 0,
        max_temp: forecastDaily.temperature_2m_max ? forecastDaily.temperature_2m_max[j] : null,
        min_temp: forecastDaily.temperature_2m_min ? forecastDaily.temperature_2m_min[j] : null
      };
    }
  }

  // 3. WeatherAPI forecast days (fill gaps in future that Open-Meteo doesn't cover)
  if (waForecastDays && waForecastDays.length) {
    for (var k = 0; k < waForecastDays.length; k++) {
      var day = waForecastDays[k];
      var dayData = day.day || {};
      // Only add if not already present from Open-Meteo
      if (!monthlyMap[day.date]) {
        monthlyMap[day.date] = {
          date: day.date,
          weather_code: weatherApiCodeToWMO(dayData.condition ? dayData.condition.code : 1000),
          max_temp: dayData.maxtemp_c || null,
          min_temp: dayData.mintemp_c || null
        };
      }
    }
  }

  return Object.values(monthlyMap).sort(function (a, b) {
    return new Date(a.date) - new Date(b.date);
  });
}

/* ───── BUILD RESPONSE FROM OPEN-METEO + WEATHERAPI ───── */

function buildFromOpenMeteo(omForecast, omAir, historicalData, waData, location) {
  if (!omForecast) return null;

  var omHourly = omForecast.hourly || {};
  var omDaily = omForecast.daily || {};
  var omCurrent = omForecast.current || {};
  var omTimezone = omForecast.timezone || "UTC";

  var waCurrent = waData ? waData.current || {} : {};
  var waForecastDays = waData && waData.forecast ? waData.forecast.forecastday || [] : [];

  // Build hourly
  var finalHourly = {
    time: omHourly.time || [],
    temperature_2m: omHourly.temperature_2m || [],
    weather_code: omHourly.weather_code || [],
    is_day: omHourly.is_day || [],
    visibility: (omHourly.visibility || []).map(function (v) { return v != null ? v : null; }),
    humidity: [],
    wind_kph: [],
    precipitation_probability: omHourly.precipitation_probability || [],
    uv: omHourly.uv_index || []
  };

  // Merge WeatherAPI hourly
  if (waForecastDays.length && omHourly.time && omHourly.time.length) {
    var waHourlyMap = {};
    for (var d = 0; d < waForecastDays.length; d++) {
      var hours = waForecastDays[d].hour || [];
      for (var h = 0; h < hours.length; h++) {
        waHourlyMap[hours[h].time] = hours[h];
      }
    }

    for (var i = 0; i < omHourly.time.length; i++) {
      var isoTime = omHourly.time[i];
      var dateObj = new Date(isoTime);

      var localParts = new Intl.DateTimeFormat("en-CA", {
        timeZone: omTimezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        hourCycle: "h23"
      }).formatToParts(dateObj);

      var yy = "", mm = "", dd = "", hh = "";
      for (var p = 0; p < localParts.length; p++) {
        if (localParts[p].type === "year") yy = localParts[p].value;
        if (localParts[p].type === "month") mm = localParts[p].value;
        if (localParts[p].type === "day") dd = localParts[p].value;
        if (localParts[p].type === "hour") hh = localParts[p].value;
      }

      var localKey = yy + "-" + mm + "-" + dd + " " + hh + ":00";
      var waHour = waHourlyMap[localKey];

      finalHourly.humidity.push(waHour ? waHour.humidity : null);
      finalHourly.wind_kph.push(waHour ? waHour.wind_kph : null);
    }
  }

  // Build daily
  var waSunrise = waForecastDays.map(function (day) {
    return day.date + "T" + convert12hTo24h(day.astro ? day.astro.sunrise : null);
  });
  var waSunset = waForecastDays.map(function (day) {
    return day.date + "T" + convert12hTo24h(day.astro ? day.astro.sunset : null);
  });

  var finalDaily = {
    time: omDaily.time || [],
    weather_code: omDaily.weather_code || [],
    temperature_2m_max: omDaily.temperature_2m_max || [],
    temperature_2m_min: omDaily.temperature_2m_min || [],
    precipitation_probability_max: omDaily.precipitation_probability_max || [],
    sunrise: omDaily.sunrise && omDaily.sunrise.length ? omDaily.sunrise : waSunrise,
    sunset: omDaily.sunset && omDaily.sunset.length ? omDaily.sunset : waSunset,
    uv_index_max: omDaily.uv_index_max || []
  };

  // Build monthly with all three sources
  var monthly = buildMonthlyData(historicalData, omDaily, waForecastDays);

  // Current data
  var nearestHourly = findNearestIndex(finalHourly.time);
  var nearestAir = omAir && omAir.hourly ? findNearestIndex(omAir.hourly.time) : 0;

  return {
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
      temperature_c: firstAvailable(waCurrent.temp_c, omCurrent.temperature_2m, finalHourly.temperature_2m[nearestHourly]),
      feelslike_c: firstAvailable(waCurrent.feelslike_c),
      humidity: firstAvailable(waCurrent.humidity),
      wind_kph: firstAvailable(waCurrent.wind_kph),
      wind_degree: firstAvailable(waCurrent.wind_degree),
      pressure_hpa: firstAvailable(waCurrent.pressure_mb),
      is_day: firstAvailable(omCurrent.is_day, finalHourly.is_day[nearestHourly], waCurrent.is_day, 1),
      weather_code: firstAvailable(omCurrent.weather_code, finalHourly.weather_code[nearestHourly], 0),
      condition_text: waCurrent.condition ? waCurrent.condition.text : null,
      uv: firstAvailable(waCurrent.uv, finalHourly.uv ? finalHourly.uv[nearestHourly] : null),
      air_quality_pm25: firstAvailable(
        omAir && omAir.hourly && omAir.hourly.pm2_5 ? omAir.hourly.pm2_5[nearestAir] : null,
        waCurrent.air_quality ? waCurrent.air_quality.pm2_5 : null
      )
    },
    daily: finalDaily,
    hourly: finalHourly,
    monthly: monthly
  };
}

/* ───── BUILD FROM WEATHERAPI ONLY ───── */

function buildFromWeatherApiOnly(waData, historicalData, location) {
  if (!waData || !waData.forecast) return null;

  var waCurrent = waData.current || {};
  var waForecastDays = waData.forecast.forecastday || [];
  var waTz = waData.location ? waData.location.tz_id : "UTC";

  // Hourly
  var hourlyTime = [];
  var hourlyTemp = [];
  var hourlyCode = [];
  var hourlyIsDay = [];
  var hourlyVisibility = [];
  var hourlyHumidity = [];
  var hourlyWindKph = [];

  for (var d = 0; d < waForecastDays.length; d++) {
    var hours = waForecastDays[d].hour || [];
    for (var h = 0; h < hours.length; h++) {
      var hour = hours[h];
      hourlyTime.push(hour.time.replace(" ", "T"));
      hourlyTemp.push(hour.temp_c);
      hourlyCode.push(weatherApiCodeToWMO(hour.condition ? hour.condition.code : 1000));
      hourlyIsDay.push(hour.is_day);
      hourlyVisibility.push(hour.vis_km ? hour.vis_km * 1000 : null);
      hourlyHumidity.push(hour.humidity);
      hourlyWindKph.push(hour.wind_kph);
    }
  }

  // Daily
  var dailyTime = [];
  var dailyCode = [];
  var dailyMax = [];
  var dailyMin = [];
  var dailyPrecip = [];
  var dailySunrise = [];
  var dailySunset = [];
  var dailyUv = [];

  for (var i = 0; i < waForecastDays.length; i++) {
    var day = waForecastDays[i];
    var dayData = day.day || {};
    var astro = day.astro || {};

    dailyTime.push(day.date);
    dailyCode.push(weatherApiCodeToWMO(dayData.condition ? dayData.condition.code : 1000));
    dailyMax.push(dayData.maxtemp_c);
    dailyMin.push(dayData.mintemp_c);
    dailyPrecip.push(dayData.daily_chance_of_rain || 0);
    dailySunrise.push(day.date + "T" + convert12hTo24h(astro.sunrise));
    dailySunset.push(day.date + "T" + convert12hTo24h(astro.sunset));
    dailyUv.push(dayData.uv || 0);
  }

  var forecastDailyObj = {
    time: dailyTime,
    weather_code: dailyCode,
    temperature_2m_max: dailyMax,
    temperature_2m_min: dailyMin
  };

  // Monthly: historical from Open-Meteo + forecast from WeatherAPI
  var monthly = buildMonthlyData(historicalData, forecastDailyObj, waForecastDays);

  var nearestHourly = findNearestIndex(hourlyTime);

  return {
    timezone: waTz,
    location: {
      key: location.key,
      name: location.name || (waData.location ? waData.location.name : "Unknown"),
      region: location.region || (waData.location ? waData.location.region : ""),
      country: location.country || (waData.location ? waData.location.country : ""),
      latitude: location.lat,
      longitude: location.lon,
      timezone: waTz
    },
    current: {
      temperature_c: firstAvailable(waCurrent.temp_c, hourlyTemp[nearestHourly]),
      feelslike_c: firstAvailable(waCurrent.feelslike_c),
      humidity: firstAvailable(waCurrent.humidity),
      wind_kph: firstAvailable(waCurrent.wind_kph),
      wind_degree: firstAvailable(waCurrent.wind_degree),
      pressure_hpa: firstAvailable(waCurrent.pressure_mb),
      is_day: firstAvailable(waCurrent.is_day, 1),
      weather_code: weatherApiCodeToWMO(waCurrent.condition ? waCurrent.condition.code : 1000),
      condition_text: waCurrent.condition ? waCurrent.condition.text : null,
      uv: firstAvailable(waCurrent.uv),
      air_quality_pm25: firstAvailable(waCurrent.air_quality ? waCurrent.air_quality.pm2_5 : null)
    },
    daily: {
      time: dailyTime,
      weather_code: dailyCode,
      temperature_2m_max: dailyMax,
      temperature_2m_min: dailyMin,
      precipitation_probability_max: dailyPrecip,
      sunrise: dailySunrise,
      sunset: dailySunset,
      uv_index_max: dailyUv
    },
    hourly: {
      time: hourlyTime,
      temperature_2m: hourlyTemp,
      weather_code: hourlyCode,
      is_day: hourlyIsDay,
      visibility: hourlyVisibility,
      humidity: hourlyHumidity,
      wind_kph: hourlyWindKph
    },
    monthly: monthly
  };
}

/* ───── ROUTES ───── */

app.get("/", function (req, res) {
  res.send("RealWeather backend is running");
});

app.get("/api/search", async function (req, res) {
  try {
    var q = (req.query.q || "").trim();
    if (!q) return res.json({ results: [] });

    var geoUrl = "https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(q) + "&count=8&language=en&format=json";
    var geoData = await safelyFetch(geoUrl, "OpenMeteo-Search");

    if (geoData && geoData.results && geoData.results.length) {
      var results = geoData.results.map(function (item) {
        return {
          name: item.name || "",
          region: item.admin1 || item.admin2 || "",
          country: item.country || "",
          latitude: item.latitude,
          longitude: item.longitude
        };
      });
      return res.json({ results: results });
    }

    var waSearchUrl = "https://api.weatherapi.com/v1/search.json?key=" + WEATHERAPI_KEY + "&q=" + encodeURIComponent(q);
    var waResults = await safelyFetch(waSearchUrl, "WeatherAPI-Search");

    if (waResults && waResults.length) {
      var waFormatted = waResults.map(function (item) {
        return {
          name: item.name || "",
          region: item.region || "",
          country: item.country || "",
          latitude: item.lat,
          longitude: item.lon
        };
      });
      return res.json({ results: waFormatted });
    }

    res.json({ results: [] });
  } catch (error) {
    console.log("SEARCH ERROR:", error);
    res.status(500).json({ results: [] });
  }
});

app.get("/api/weather", async function (req, res) {
  try {
    var location;
    if (req.query.lat != null || req.query.lon != null || req.query.city) {
      location = await resolveLocation(req.query);
    } else {
      location = await resolveIpLocation();
    }

    // Check cache
    var cacheKey = getCacheKey(location.lat, location.lon);
    var cached = getCached(cacheKey);
    if (cached) {
      console.log("Serving from cache for:", location.name);
      if (location.name && location.name !== "Unknown location" && location.name !== "") {
        cached.location.name = location.name;
        cached.location.region = location.region;
        cached.location.country = location.country;
      }
      return res.json(cached);
    }

    console.log("Fetching weather for:", location.name, location.lat, location.lon);

    // Always try to fetch historical data from Open-Meteo (separate endpoint, separate rate limit)
    var historicalData = await fetchHistoricalData(location);
    if (historicalData) {
      console.log("Historical data loaded:", (historicalData.daily && historicalData.daily.time ? historicalData.daily.time.length : 0), "days");
    } else {
      console.log("No historical data available");
    }

    // Try Open-Meteo forecast + air quality
    var omForecast = await fetchOpenMeteoForecast(location);
    var omAir = await fetchOpenMeteoAir(location);

    // Always fetch WeatherAPI (for current conditions and as fallback)
    var waData = await fetchWeatherApiData(location);

    var result = null;

    // Strategy 1: Open-Meteo forecast works → use as primary with WeatherAPI supplement
    if (omForecast) {
      console.log("Using Open-Meteo as primary source");
      result = buildFromOpenMeteo(omForecast, omAir, historicalData, waData, location);
    }

    // Strategy 2: Open-Meteo failed → use WeatherAPI only with Open-Meteo historical
    if (!result && waData) {
      console.log("Open-Meteo forecast failed, using WeatherAPI as fallback");
      result = buildFromWeatherApiOnly(waData, historicalData, location);
    }

    // Strategy 3: Everything failed
    if (!result) {
      console.log("All APIs failed");
      return res.status(503).json({ error: "All weather APIs are unavailable. Please try again later." });
    }

    // Fix location name
    if ((!result.location.name || result.location.name === "Unknown location" || result.location.name === "") && waData && waData.location) {
      result.location.name = waData.location.name || result.location.name;
      result.location.region = waData.location.region || result.location.region;
      result.location.country = waData.location.country || result.location.country;
    }

    // Cache
    setCache(cacheKey, result);

    console.log("Response ready. Monthly days:", result.monthly ? result.monthly.length : 0);
    res.json(result);
  } catch (error) {
    console.log("BACKEND ERROR:", error);
    res.status(500).json({ error: "Failed to fetch weather data" });
  }
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
  console.log("Server running on http://localhost:" + PORT);
});