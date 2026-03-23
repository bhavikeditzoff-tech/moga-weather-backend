require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const WEATHERAPI_KEY = process.env.WEATHERAPI_KEY;
const TOMORROW_KEY = process.env.TOMORROW_API_KEY;
const WEATHERBIT_KEY = process.env.WEATHERBIT_API_KEY;
const VISUAL_CROSSING_KEY = process.env.VISUAL_CROSSING_API_KEY;
const PIRATE_KEY = process.env.PIRATE_WEATHER_KEY;
const OPENWEATHER_KEY = process.env.OPENWEATHER_KEY;
const ACCUWEATHER_API_KEY = process.env.ACCUWEATHER_API_KEY;
const METEOBLUE_API_KEY = process.env.METEOBLUE_API_KEY;
const CHECKWX_API_KEY = process.env.CHECKWX_API_KEY;

/* ───── CACHE ───── */

var generalCache = {};
var accuLocationCache = {};
var accuForecastCache = {};

var GENERAL_CACHE_MS = 10 * 60 * 1000;
var ACCU_LOCATION_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
var ACCU_FORECAST_CACHE_MS = 6 * 60 * 60 * 1000;

function getCached(store, key, maxAge) {
  var entry = store[key];
  if (!entry) return null;
  if (Date.now() - entry.time > maxAge) {
    delete store[key];
    return null;
  }
  return entry.data;
}

function setCached(store, key, data) {
  var keys = Object.keys(store);
  if (keys.length > 300) {
    var sorted = keys.sort(function (a, b) {
      return (store[a].time || 0) - (store[b].time || 0);
    });
    for (var i = 0; i < 100; i++) delete store[sorted[i]];
  }
  store[key] = { data: data, time: Date.now() };
}

function makeCK(lat, lon) {
  return (Math.round(lat * 10) / 10) + "," + (Math.round(lon * 10) / 10);
}

function getC(key) {
  return getCached(generalCache, key, GENERAL_CACHE_MS);
}

function putC(key, data) {
  setCached(generalCache, key, data);
}

/* ───── HELPERS ───── */

function first() {
  for (var i = 0; i < arguments.length; i++) {
    var v = arguments[i];
    if (v !== undefined && v !== null && v !== "" && !Number.isNaN(v)) return v;
  }
  return null;
}

function roundVal(v) {
  return v == null || isNaN(v) ? null : Math.round(v);
}

function avg(nums) {
  var clean = nums.filter(function (n) { return n != null && !isNaN(n); });
  if (!clean.length) return null;
  return clean.reduce(function (a, b) { return a + b; }, 0) / clean.length;
}

function majority(values) {
  var counts = {};
  var best = null;
  var max = -1;
  for (var i = 0; i < values.length; i++) {
    var v = values[i];
    if (v == null) continue;
    counts[v] = (counts[v] || 0) + 1;
    if (counts[v] > max) {
      max = counts[v];
      best = Number(v);
    }
  }
  return best;
}

function sf(url, label) {
  return fetch(url)
    .then(function (r) {
      if (!r.ok) {
        return r.text().catch(function () { return ""; }).then(function (t) {
          console.log(label + " HTTP " + r.status + ": " + t.substring(0, 500));
          return null;
        });
      }
      return r.json();
    })
    .catch(function (e) {
      console.log(label + " ERR: " + e.message);
      return null;
    });
}

function c12to24(t) {
  if (!t) return "00:00:00";
  var p = t.split(" ");
  var time = p[0];
  var mod = p[1];
  var tp = time.split(":");
  var h = tp[0];
  var m = tp[1];
  if (h === "12") h = "00";
  if (mod === "PM") h = String(parseInt(h, 10) + 12);
  return h.padStart(2, "0") + ":" + m + ":00";
}

function epochToLocalISO(epochSec, tz) {
  var d = new Date(epochSec * 1000);
  try {
    var parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(d);

    var yy = "", mm = "", dd = "", hh = "", mi = "";
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].type === "year") yy = parts[i].value;
      if (parts[i].type === "month") mm = parts[i].value;
      if (parts[i].type === "day") dd = parts[i].value;
      if (parts[i].type === "hour") hh = parts[i].value;
      if (parts[i].type === "minute") mi = parts[i].value;
    }
    return yy + "-" + mm + "-" + dd + "T" + hh + ":" + mi + ":00";
  } catch (e) {
    return d.toISOString();
  }
}

function getLocalHour(epochSec, tz) {
  try {
    var d = new Date(epochSec * 1000);
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hourCycle: "h23"
    }).formatToParts(d);
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].type === "hour") return parseInt(parts[i].value);
    }
  } catch (e) {}
  return new Date(epochSec * 1000).getUTCHours();
}

function getIsDayNow(tz) {
  try {
    var d = new Date();
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hourCycle: "h23"
    }).formatToParts(d);
    var hh = 12;
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].type === "hour") {
        hh = parseInt(parts[i].value);
        break;
      }
    }
    return (hh >= 6 && hh < 18) ? 1 : 0;
  } catch (e) {
    return 1;
  }
}

/* ───── WEATHER CODE CONVERTERS ───── */

function waCodeToWMO(c) {
  var m = {
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
  return m[c] !== undefined ? m[c] : 0;
}

function wbCodeToWMO(c) {
  if (!c) return 0;
  var n = Number(c);
  if (n >= 200 && n < 300) return 95;
  if (n >= 300 && n < 400) return 51;
  if (n >= 500 && n < 600) return 63;
  if (n >= 600 && n < 700) return 73;
  if (n >= 700 && n < 800) return 45;
  if (n === 800) return 0;
  if (n === 801) return 1;
  if (n === 802) return 2;
  if (n >= 803) return 3;
  return 0;
}

function pirateToWMO(icon) {
  if (!icon) return 0;
  var i = String(icon).toLowerCase();
  if (i === "clear-day" || i === "clear-night") return 0;
  if (i === "partly-cloudy-day" || i === "partly-cloudy-night") return 2;
  if (i === "cloudy") return 3;
  if (i === "fog") return 45;
  if (i === "rain") return 63;
  if (i === "sleet") return 66;
  if (i === "snow") return 73;
  if (i === "wind") return 3;
  return 2;
}

function vcToWMO(icon) {
  if (!icon) return 0;
  var i = String(icon).toLowerCase();
  if (i.indexOf("clear") >= 0 || i.indexOf("sun") >= 0) return 0;
  if (i.indexOf("partly") >= 0) return 2;
  if (i.indexOf("cloud") >= 0 || i.indexOf("overcast") >= 0) return 3;
  if (i.indexOf("fog") >= 0 || i.indexOf("mist") >= 0) return 45;
  if (i.indexOf("thunder") >= 0) return 95;
  if (i.indexOf("snow") >= 0) return 73;
  if (i.indexOf("sleet") >= 0 || i.indexOf("ice") >= 0) return 66;
  if (i.indexOf("heavy") >= 0 && i.indexOf("rain") >= 0) return 65;
  if (i.indexOf("rain") >= 0 || i.indexOf("drizzle") >= 0 || i.indexOf("shower") >= 0) return 61;
  return 2;
}

function accuPhraseToWMO(text) {
  if (!text) return 0;
  var s = String(text).toLowerCase();
  if (s.indexOf("clear") >= 0 || s.indexOf("sunny") >= 0) return 0;
  if (s.indexOf("mostly sunny") >= 0) return 1;
  if (s.indexOf("partly cloudy") >= 0 || s.indexOf("partly sunny") >= 0) return 2;
  if (s.indexOf("cloud") >= 0 || s.indexOf("overcast") >= 0) return 3;
  if (s.indexOf("fog") >= 0 || s.indexOf("mist") >= 0) return 45;
  if (s.indexOf("drizzle") >= 0) return 51;
  if (s.indexOf("thunder") >= 0 || s.indexOf("storm") >= 0) return 95;
  if (s.indexOf("snow") >= 0) return 73;
  if (s.indexOf("sleet") >= 0 || s.indexOf("ice") >= 0 || s.indexOf("freezing rain") >= 0) return 66;
  if (s.indexOf("shower") >= 0) return 80;
  if (s.indexOf("rain") >= 0) return 63;
  return 2;
}

function owmCodeToWMO(c) {
  if (!c) return 0;
  var n = Number(c);
  if (n >= 200 && n < 300) return 95;
  if (n >= 300 && n < 400) return 51;
  if (n >= 500 && n < 600) return 63;
  if (n >= 600 && n < 700) return 73;
  if (n >= 700 && n < 800) return 45;
  if (n === 800) return 0;
  if (n === 801) return 1;
  if (n === 802) return 2;
  if (n >= 803) return 3;
  return 0;
}

function getWeatherText(code, isDay) {
  if (isDay === undefined) isDay = 1;
  if (code === 0) return isDay ? "Sunny" : "Clear night";
  if (code === 1) return isDay ? "Mostly sunny" : "Mostly clear";
  if (code === 2) return isDay ? "Partly cloudy" : "Night cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 55) return "Drizzle";
  if (code === 56 || code === 57) return "Freezing drizzle";
  if (code === 61) return "Light rain";
  if (code === 63) return "Rain";
  if (code === 65) return "Heavy rain";
  if (code === 66 || code === 67) return "Freezing rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code === 85 || code === 86) return "Snow showers";
  if (code === 95) return "Thunderstorm";
  if (code === 96 || code === 99) return "Thunderstorm with hail";
  return "Weather update";
}

/* ───── LOCATION ───── */

var PRESETS = {
  moga: { key: "moga", name: "Moga", region: "Punjab", country: "India", lat: 30.8165, lon: 75.1717 }
};

async function resolveLoc(q) {
  var city = (q.city || "").trim();
  var ckey = city.toLowerCase();
  var lat = q.lat != null ? Number(q.lat) : null;
  var lon = q.lon != null ? Number(q.lon) : null;

  if (lat != null && lon != null && !isNaN(lat) && !isNaN(lon)) {
    var r = await sf("https://api.weatherapi.com/v1/search.json?key=" + WEATHERAPI_KEY + "&q=" + lat + "," + lon, "RevGeo");
    if (r && r.length) {
      return {
        key: "coords",
        name: r[0].name || "",
        region: r[0].region || "",
        country: r[0].country || "",
        lat: lat,
        lon: lon
      };
    }
    return { key: "coords", name: "", region: "", country: "", lat: lat, lon: lon };
  }

  if (ckey && PRESETS[ckey]) return PRESETS[ckey];

  if (city) {
    var wa = await sf("https://api.weatherapi.com/v1/search.json?key=" + WEATHERAPI_KEY + "&q=" + encodeURIComponent(city), "WA-Geo");
    if (wa && wa.length) {
      return {
        key: ckey,
        name: wa[0].name || city,
        region: wa[0].region || "",
        country: wa[0].country || "",
        lat: wa[0].lat,
        lon: wa[0].lon
      };
    }
  }

  return PRESETS.moga;
}

async function resolveIp() {
  return PRESETS.moga;
}

/* ───── FETCHERS ───── */

async function fetchWeatherApi(loc) {
  return await sf(
    "https://api.weatherapi.com/v1/forecast.json?key=" + WEATHERAPI_KEY +
      "&q=" + loc.lat + "," + loc.lon +
      "&days=3&aqi=yes&alerts=no",
    "WeatherAPI"
  );
}

async function fetchTomorrowCurrent(loc) {
  if (!TOMORROW_KEY) return null;
  return await sf(
    "https://api.tomorrow.io/v4/timelines?location=" + loc.lat + "," + loc.lon +
      "&fields=temperature,temperatureApparent,cloudCover,dewPoint,treeIndex,grassIndex,weedIndex" +
      "&timesteps=current&units=metric&apikey=" + TOMORROW_KEY,
    "Tomorrow-Current"
  );
}

async function fetchWeatherbitCurrent(loc) {
  if (!WEATHERBIT_KEY) return null;
  return await sf(
    "https://api.weatherbit.io/v2.0/current?lat=" + loc.lat + "&lon=" + loc.lon + "&key=" + WEATHERBIT_KEY,
    "Weatherbit-Current"
  );
}

async function fetchWeatherbitDaily(loc) {
  if (!WEATHERBIT_KEY) return null;
  return await sf(
    "https://api.weatherbit.io/v2.0/forecast/daily?lat=" + loc.lat + "&lon=" + loc.lon + "&days=7&key=" + WEATHERBIT_KEY,
    "Weatherbit-Daily"
  );
}

async function fetchPirate(loc) {
  if (!PIRATE_KEY) return null;
  return await sf(
    "https://api.pirateweather.net/forecast/" + PIRATE_KEY + "/" + loc.lat + "," + loc.lon +
      "?units=si&exclude=minutely,alerts",
    "Pirate"
  );
}

async function fetchOpenWeather(loc) {
  if (!OPENWEATHER_KEY) return null;
  return await sf(
    "https://api.openweathermap.org/data/2.5/weather?lat=" + loc.lat + "&lon=" + loc.lon +
      "&appid=" + OPENWEATHER_KEY + "&units=metric",
    "OpenWeather"
  );
}

async function fetchOpenMeteoCurrent(loc) {
  return await sf(
    "https://api.open-meteo.com/v1/forecast?latitude=" + loc.lat +
      "&longitude=" + loc.lon +
      "&current=temperature_2m,apparent_temperature&timezone=auto",
    "OpenMeteo-Current"
  );
}

async function fetchOpenMeteoHourly(loc) {
  return await sf(
    "https://api.open-meteo.com/v1/forecast?latitude=" + loc.lat +
      "&longitude=" + loc.lon +
      "&hourly=temperature_2m,weather_code,is_day&timezone=auto&forecast_days=2",
    "OpenMeteo-Hourly"
  );
}

async function fetchOpenMeteoDaily7(loc) {
  return await sf(
    "https://api.open-meteo.com/v1/forecast?latitude=" + loc.lat +
      "&longitude=" + loc.lon +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max" +
      "&timezone=auto&forecast_days=7",
    "OpenMeteo-Daily7"
  );
}

async function fetchOpenMeteoStorm(loc) {
  return await sf(
    "https://api.open-meteo.com/v1/forecast?latitude=" + loc.lat +
      "&longitude=" + loc.lon +
      "&hourly=cape,precipitation_probability&timezone=auto&forecast_days=1",
    "OpenMeteo-Storm"
  );
}

async function fetchVisualCrossing7(loc) {
  if (!VISUAL_CROSSING_KEY) return null;
  var now = new Date();
  var start = now.toISOString().split("T")[0];
  var endDate = new Date(now);
  endDate.setDate(endDate.getDate() + 6);
  var end = endDate.toISOString().split("T")[0];

  return await sf(
    "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/" +
      loc.lat + "," + loc.lon + "/" + start + "/" + end +
      "?key=" + VISUAL_CROSSING_KEY + "&unitGroup=metric&include=days",
    "VisualCrossing-7"
  );
}

async function fetchAccuLocationKey(loc) {
  if (!ACCUWEATHER_API_KEY) return null;

  var key = makeCK(loc.lat, loc.lon);
  var cached = getCached(accuLocationCache, key, ACCU_LOCATION_CACHE_MS);
  if (cached) return cached;

  var url =
    "https://dataservice.accuweather.com/locations/v1/cities/geoposition/search?apikey=" +
    ACCUWEATHER_API_KEY + "&q=" + loc.lat + "%2C" + loc.lon;

  var data = await sf(url, "AccuWeather-Location");
  if (data && data.Key) {
    setCached(accuLocationCache, key, data.Key);
    return data.Key;
  }
  return null;
}

async function fetchAccuForecast(loc) {
  if (!ACCUWEATHER_API_KEY) {
    console.log("AccuWeather forecast skipped: missing key");
    return null;
  }

  var key = makeCK(loc.lat, loc.lon);
  var cached = getCached(accuForecastCache, key, ACCU_FORECAST_CACHE_MS);
  if (cached) {
    console.log("AccuWeather forecast cache hit:", key);
    return cached;
  }

  var locationKey = await fetchAccuLocationKey(loc);
  if (!locationKey) {
    console.log("AccuWeather forecast skipped: no location key");
    return null;
  }

  var url =
    "https://dataservice.accuweather.com/forecasts/v1/daily/5day/" +
    locationKey +
    "?apikey=" + ACCUWEATHER_API_KEY +
    "&metric=true&details=true";

  var data = await sf(url, "AccuWeather-5Day");
  if (data && data.DailyForecasts) {
    setCached(accuForecastCache, key, data);
    return data;
  }

  console.log("AccuWeather forecast failed");
  return null;
}

async function fetchVisualCrossingMonthly(loc) {
  if (!VISUAL_CROSSING_KEY) return null;

  var now = new Date();
  var y = now.getFullYear();
  var m = String(now.getMonth() + 1).padStart(2, "0");
  var monthStart = y + "-" + m + "-01";
  var monthEndDate = new Date(y, now.getMonth() + 1, 0);
  var monthEnd = monthEndDate.toISOString().split("T")[0];

  return await sf(
    "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/" +
      loc.lat + "," + loc.lon + "/" + monthStart + "/" + monthEnd +
      "?key=" + VISUAL_CROSSING_KEY + "&unitGroup=metric&include=days",
    "VisualCrossing-Monthly"
  );
}

async function fetchMeteoblueCurrent(loc) {
  if (!METEOBLUE_API_KEY) return null;
  return await sf(
    "https://my.meteoblue.com/packages/basic-1h?apikey=" + METEOBLUE_API_KEY +
      "&lat=" + loc.lat + "&lon=" + loc.lon + "&asl=0&format=json",
    "Meteoblue-Current"
  );
}

async function fetchCheckWX(loc) {
  if (!CHECKWX_API_KEY) return null;
  return await fetch(
    "https://api.checkwx.com/metar/lat/" + loc.lat + "/lon/" + loc.lon + "/radius/50/decoded",
    { headers: { "X-API-Key": CHECKWX_API_KEY } }
  )
    .then(function (r) {
      if (!r.ok) {
        return r.text().catch(function () { return ""; }).then(function (t) {
          console.log("CheckWX HTTP " + r.status + ": " + t.substring(0, 400));
          return null;
        });
      }
      return r.json();
    })
    .catch(function (e) {
      console.log("CheckWX ERR:", e.message);
      return null;
    });
}

/* ───── PARSERS ───── */

function parseTomorrowCurrent(tmData) {
  var vals = {
    temp: null,
    feelsLike: null,
    cloudCover: null,
    dewPoint: null,
    treePollen: null,
    grassPollen: null,
    weedPollen: null
  };

  if (tmData && tmData.data && tmData.data.timelines && tmData.data.timelines.length) {
    var intervals = tmData.data.timelines[0].intervals || [];
    if (intervals.length && intervals[0].values) {
      var v = intervals[0].values;
      vals.temp = v.temperature;
      vals.feelsLike = v.temperatureApparent;
      vals.cloudCover = v.cloudCover;
      vals.dewPoint = v.dewPoint;
      vals.treePollen = v.treeIndex;
      vals.grassPollen = v.grassIndex;
      vals.weedPollen = v.weedIndex;
    }
  }

  return vals;
}

function parseMeteoblueCurrent(mbData) {
  var out = {
    cloudCover: null,
    cloudCeiling: null
  };

  if (!mbData) return out;

  if (mbData.data_1h && mbData.data_1h.cloudcover && mbData.data_1h.cloudcover.length) {
    out.cloudCover = mbData.data_1h.cloudcover[0];
  }
  if (mbData.data_1h && mbData.data_1h.cloud_ceiling && mbData.data_1h.cloud_ceiling.length) {
    out.cloudCeiling = mbData.data_1h.cloud_ceiling[0];
  }
  if (mbData.data && mbData.data.cloudcover && mbData.data.cloudcover.length) {
    out.cloudCover = first(out.cloudCover, mbData.data.cloudcover[0]);
  }
  if (mbData.data && mbData.data.cloud_ceiling && mbData.data.cloud_ceiling.length) {
    out.cloudCeiling = first(out.cloudCeiling, mbData.data.cloud_ceiling[0]);
  }

  return out;
}

function parseCheckWXCeiling(cwx) {
  if (!cwx || !cwx.data || !cwx.data.length) return null;
  var metar = cwx.data[0];
  if (!metar) return null;

  if (metar.ceiling && metar.ceiling.feet != null) {
    return metar.ceiling.feet;
  }

  if (metar.clouds && Array.isArray(metar.clouds) && metar.clouds.length) {
    var fallbackFeet = null;

    for (var i = 0; i < metar.clouds.length; i++) {
      var cl = metar.clouds[i];
      var code = String(cl.code || cl.type || "").toUpperCase();
      var baseFeet = first(cl.base_feet_agl, cl.base_feet, cl.altitude_feet, cl.altitude, cl.feet);

      if ((code === "BKN" || code === "OVC" || code === "VV") && baseFeet != null) {
        return Number(baseFeet);
      }

      if (fallbackFeet == null && baseFeet != null) {
        fallbackFeet = Number(baseFeet);
      }
    }

    return fallbackFeet;
  }

  return null;
}

function parseAccuPollen(accuData) {
  if (!accuData || !accuData.DailyForecasts || !accuData.DailyForecasts.length) return null;
  var day = accuData.DailyForecasts[0];
  if (!day.AirAndPollen || !day.AirAndPollen.length) return null;

  var pollenValues = [];
  for (var i = 0; i < day.AirAndPollen.length; i++) {
    var ap = day.AirAndPollen[i];
    var name = String(ap.Name || "").toLowerCase();
    if (
      name.indexOf("tree") >= 0 ||
      name.indexOf("grass") >= 0 ||
      name.indexOf("ragweed") >= 0 ||
      name.indexOf("mold") >= 0
    ) {
      if (ap.Value != null && !isNaN(ap.Value)) pollenValues.push(Number(ap.Value));
    }
  }

  if (!pollenValues.length) return null;
  return roundVal(avg(pollenValues));
}

function parseOpenMeteoStorm(omStorm) {
  var out = {
    precipitation_probability: null,
    cape: null
  };

  if (!omStorm || !omStorm.hourly || !omStorm.hourly.time || !omStorm.hourly.time.length) return out;

  var idx = 0;
  var best = Infinity;
  var now = Date.now();

  for (var i = 0; i < omStorm.hourly.time.length; i++) {
    var t = new Date(omStorm.hourly.time[i]).getTime();
    var d = Math.abs(now - t);
    if (d < best) {
      best = d;
      idx = i;
    }
  }

  out.precipitation_probability = omStorm.hourly.precipitation_probability ? omStorm.hourly.precipitation_probability[idx] : null;
  out.cape = omStorm.hourly.cape ? omStorm.hourly.cape[idx] : null;
  return out;
}

function getCapeFactor(cape) {
  if (cape == null || isNaN(cape)) return 0;
  if (cape < 100) return 5;
  if (cape < 250) return 15;
  if (cape < 500) return 30;
  if (cape < 1000) return 50;
  if (cape < 2000) return 70;
  return 90;
}

function computeStormProbability(precipProb, cloudCover, cape) {
  var p = first(precipProb, 0);
  var c = first(cloudCover, 0);
  var capeVal = first(cape, 0);
  var capeFactor = getCapeFactor(capeVal);

  if (p < 10 && capeVal < 500) {
    return 0;
  }

  var stormProbability =
    (p * 0.6) +
    (c * 0.1) +
    (capeFactor * 0.3);

  stormProbability = Math.min(100, stormProbability);
  return roundVal(stormProbability);
}

/* ───── HOURLY ───── */

function buildHourlyFromOpenMeteo(omHourlyData, currentTemp, currentWeatherCode, tz) {
  var out = {
    time: [],
    temperature_2m: [],
    weather_code: [],
    is_day: []
  };

  if (!omHourlyData || !omHourlyData.hourly || !omHourlyData.hourly.time || !omHourlyData.hourly.time.length) {
    return out;
  }

  var h = omHourlyData.hourly;

  var now = new Date();
  var parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);

  var yy = "", mm = "", dd = "", hh = "";
  for (var p = 0; p < parts.length; p++) {
    if (parts[p].type === "year") yy = parts[p].value;
    if (parts[p].type === "month") mm = parts[p].value;
    if (parts[p].type === "day") dd = parts[p].value;
    if (parts[p].type === "hour") hh = parts[p].value;
  }

  var currentHourKey = yy + "-" + mm + "-" + dd + "T" + hh;

  var startIdx = -1;
  for (var i = 0; i < h.time.length; i++) {
    if (String(h.time[i]).substring(0, 13) === currentHourKey) {
      startIdx = i;
      break;
    }
  }

  if (startIdx === -1) {
    for (var j = 0; j < h.time.length; j++) {
      if (String(h.time[j]).substring(0, 13) >= currentHourKey) {
        startIdx = j;
        break;
      }
    }
  }

  if (startIdx === -1) startIdx = 0;

  for (var k = startIdx; k < h.time.length && out.time.length < 24; k++) {
    out.time.push(h.time[k]);
    out.temperature_2m.push(h.temperature_2m ? roundVal(h.temperature_2m[k]) : null);
    out.weather_code.push(h.weather_code ? h.weather_code[k] : 0);
    out.is_day.push(h.is_day ? h.is_day[k] : 1);
  }

  if (out.temperature_2m.length && currentTemp != null) {
    out.temperature_2m[0] = roundVal(currentTemp);
  }

  if (out.weather_code.length && currentWeatherCode != null) {
    out.weather_code[0] = currentWeatherCode;
  }

  return out;
}

/* ───── TIME PERIODS ───── */

function buildTimePeriodsFromHourly(hourly, prData, tz) {
  var periods = [
    { name: "Morning", startH: 6, endH: 12 },
    { name: "Afternoon", startH: 12, endH: 17 },
    { name: "Evening", startH: 17, endH: 21 },
    { name: "Overnight", startH: 21, endH: 30 }
  ];

  var allHours = [];
  for (var i = 0; i < hourly.time.length; i++) {
    allHours.push({
      localDate: hourly.time[i].substring(0, 10),
      localHour: parseInt(hourly.time[i].substring(11, 13)),
      temp: hourly.temperature_2m[i],
      code: hourly.weather_code[i],
      precip: null
    });
  }

  if (prData && prData.hourly && prData.hourly.data) {
    for (var p = 0; p < prData.hourly.data.length; p++) {
      var pe = prData.hourly.data[p].time || 0;
      allHours.push({
        localDate: epochToLocalISO(pe, tz).substring(0, 10),
        localHour: getLocalHour(pe, tz),
        temp: roundVal(prData.hourly.data[p].temperature),
        code: pirateToWMO(prData.hourly.data[p].icon),
        precip: prData.hourly.data[p].precipProbability != null ? Math.round(prData.hourly.data[p].precipProbability * 100) : null
      });
    }
  }

  var nowEpoch = Math.floor(Date.now() / 1000);
  var todayLocal = epochToLocalISO(nowEpoch, tz).substring(0, 10);
  var nowLocalHour = getLocalHour(nowEpoch, tz);
  var tmrwDate = epochToLocalISO(nowEpoch + 86400, tz).substring(0, 10);

  var result = [];

  for (var pi = 0; pi < periods.length; pi++) {
    var per = periods[pi];
    var temps = [], codes = {}, precips = [];

    for (var ai = 0; ai < allHours.length; ai++) {
      var ah = allHours[ai];
      var inPeriod = false;

      if (per.name === "Overnight") {
        if ((ah.localDate === todayLocal && ah.localHour >= 21) || (ah.localDate === tmrwDate && ah.localHour < 6)) {
          inPeriod = true;
        }
      } else {
        var targetDate = todayLocal;
        if (per.endH <= nowLocalHour) targetDate = tmrwDate;
        if (ah.localDate === targetDate && ah.localHour >= per.startH && ah.localHour < per.endH) {
          inPeriod = true;
        }
      }

      if (inPeriod) {
        if (ah.temp != null) temps.push(ah.temp);
        if (ah.code != null) codes[ah.code] = (codes[ah.code] || 0) + 1;
        if (ah.precip != null) precips.push(ah.precip);
      }
    }

    var avgTemp = temps.length ? Math.round(temps.reduce(function (a, b) { return a + b; }, 0) / temps.length) : null;
    var avgPrecip = precips.length ? Math.round(precips.reduce(function (a, b) { return a + b; }, 0) / precips.length) : null;
    var dominantCode = 0, maxCount = 0;
    var keys = Object.keys(codes);
    for (var ci = 0; ci < keys.length; ci++) {
      if (codes[keys[ci]] > maxCount) {
        maxCount = codes[keys[ci]];
        dominantCode = Number(keys[ci]);
      }
    }

    result.push({
      name: per.name,
      temp: avgTemp,
      weather_code: dominantCode,
      precip_chance: avgPrecip,
      has_data: temps.length > 0
    });
  }

  return result;
}

/* ───── DAILY 7 DAYS ───── */

function buildDaily(accuData, omDaily7, wbDaily, vc7) {
  var out = [];

  if (accuData && accuData.DailyForecasts) {
    var list = accuData.DailyForecasts;
    var count = Math.min(5, list.length);

    for (var i = 0; i < count; i++) {
      var d = list[i];
      var dateStr = d.Date ? new Date(d.Date).toISOString().split("T")[0] : null;

      var uvVal = null;
      if (d.AirAndPollen && d.AirAndPollen.length) {
        for (var p = 0; p < d.AirAndPollen.length; p++) {
          if (d.AirAndPollen[p].Name === "UVIndex") {
            uvVal = d.AirAndPollen[p].Value;
            break;
          }
        }
      }

      out.push({
        date: dateStr,
        weather_code: accuPhraseToWMO(
          d.Day && d.Day.IconPhrase ? d.Day.IconPhrase :
          d.Night && d.Night.IconPhrase ? d.Night.IconPhrase : ""
        ),
        max_temp: d.Temperature && d.Temperature.Maximum ? d.Temperature.Maximum.Value : null,
        min_temp: d.Temperature && d.Temperature.Minimum ? d.Temperature.Minimum.Value : null,
        precip_chance: d.Day && d.Day.PrecipitationProbability != null ? d.Day.PrecipitationProbability : null,
        sunrise: d.Sun && d.Sun.Rise ? new Date(d.Sun.Rise).toISOString().substring(0, 19) : null,
        sunset: d.Sun && d.Sun.Set ? new Date(d.Sun.Set).toISOString().substring(0, 19) : null,
        uv: uvVal
      });
    }
  }

  for (var idx = 5; idx < 7; idx++) {
    var maxCandidates = [];
    var minCandidates = [];
    var condCandidates = [];
    var precipCandidates = [];
    var date = null;
    var sunrise = null;
    var sunset = null;
    var uv = null;

    if (omDaily7 && omDaily7.daily && omDaily7.daily.time && omDaily7.daily.time[idx]) {
      date = omDaily7.daily.time[idx];
      if (omDaily7.daily.temperature_2m_max) maxCandidates.push(omDaily7.daily.temperature_2m_max[idx]);
      if (omDaily7.daily.temperature_2m_min) minCandidates.push(omDaily7.daily.temperature_2m_min[idx]);
      if (omDaily7.daily.weather_code) condCandidates.push(omDaily7.daily.weather_code[idx]);
      if (omDaily7.daily.precipitation_probability_max) precipCandidates.push(omDaily7.daily.precipitation_probability_max[idx]);
      if (omDaily7.daily.sunrise) sunrise = omDaily7.daily.sunrise[idx];
      if (omDaily7.daily.sunset) sunset = omDaily7.daily.sunset[idx];
      if (omDaily7.daily.uv_index_max) uv = omDaily7.daily.uv_index_max[idx];
    }

    if (wbDaily && wbDaily.data && wbDaily.data[idx]) {
      var wb = wbDaily.data[idx];
      if (!date) date = wb.datetime || wb.valid_date;
      maxCandidates.push(first(wb.high_temp, wb.max_temp));
      minCandidates.push(first(wb.low_temp, wb.min_temp));
      if (wb.weather && wb.weather.code != null) condCandidates.push(wbCodeToWMO(wb.weather.code));
      if (wb.pop != null) precipCandidates.push(wb.pop);
      if (uv == null) uv = first(wb.uv, wb.max_uv);
    }

    if (vc7 && vc7.days && vc7.days[idx]) {
      var vc = vc7.days[idx];
      if (!date) date = vc.datetime;
      maxCandidates.push(vc.tempmax);
      minCandidates.push(vc.tempmin);
      condCandidates.push(vcToWMO(first(vc.icon, vc.conditions, "")));
      if (vc.precipprob != null) precipCandidates.push(vc.precipprob);
      if (!sunrise && vc.sunrise) sunrise = vc.datetime + "T" + vc.sunrise;
      if (!sunset && vc.sunset) sunset = vc.datetime + "T" + vc.sunset;
      if (uv == null && vc.uvindex != null) uv = vc.uvindex;
    }

    if (date) {
      out.push({
        date: date,
        weather_code: majority(condCandidates),
        max_temp: avg(maxCandidates) != null ? Math.round(avg(maxCandidates) * 10) / 10 : null,
        min_temp: avg(minCandidates) != null ? Math.round(avg(minCandidates) * 10) / 10 : null,
        precip_chance: avg(precipCandidates) != null ? Math.round(avg(precipCandidates)) : null,
        sunrise: sunrise,
        sunset: sunset,
        uv: uv
      });
    }
  }

  return out;
}

/* ───── MONTHLY = VC HISTORY + 7-DAY FUTURE ONLY ───── */

function buildMonthly(vcMonthlyData, dailyArray) {
  var map = {};
  var today = new Date().toISOString().split("T")[0];

  if (vcMonthlyData && vcMonthlyData.days) {
    for (var i = 0; i < vcMonthlyData.days.length; i++) {
      var d = vcMonthlyData.days[i];
      if (!d.datetime) continue;

      if (d.datetime <= today) {
        map[d.datetime] = {
          date: d.datetime,
          weather_code: vcToWMO(first(d.icon, d.conditions, "")),
          max_temp: d.tempmax != null ? d.tempmax : null,
          min_temp: d.tempmin != null ? d.tempmin : null,
          available: true
        };
      }
    }
  }

  for (var j = 0; j < dailyArray.length; j++) {
    var dy = dailyArray[j];
    if (!dy.date) continue;
    map[dy.date] = {
      date: dy.date,
      weather_code: dy.weather_code,
      max_temp: dy.max_temp,
      min_temp: dy.min_temp,
      available: true
    };
  }

  return Object.values(map).sort(function (a, b) {
    return new Date(a.date) - new Date(b.date);
  });
}

/* ───── RECOMMENDATIONS ENGINE ───── */

function buildRecommendations(payload) {
  var recs = [];

  var temp = payload.currentTemp;
  var feels = payload.realFeel;
  var rain = payload.rainChance;
  var uv = payload.uv;
  var aqi = payload.aqi;
  var humidity = payload.humidity;
  var wind = payload.wind;
  var visibility = payload.visibilityKm;
  var thunder = payload.thunderProbability;
  var cloud = payload.cloudCover;
  var sunset = payload.sunsetText;

  if (temp != null) {
    if (temp >= 35) recs.push("It’s extremely hot outside — avoid long exposure and stay hydrated.");
    else if (temp >= 30) recs.push("A warm day ahead — light clothing and water will help.");
    else if (temp <= 12) recs.push("It’s fairly cool — a light jacket may feel comfortable.");
    else recs.push("The temperature feels comfortable for most outdoor activity.");
  }

  if (feels != null && temp != null) {
    if (feels - temp >= 3) recs.push("It feels warmer than the actual temperature, so the heat may be stronger than expected.");
    else if (temp - feels >= 3) recs.push("It may feel cooler than the actual air temperature thanks to shade or airflow.");
  }

  if (rain != null) {
    if (rain >= 70) recs.push("Rain is likely — carrying an umbrella is a good idea.");
    else if (rain >= 40) recs.push("There is a fair chance of rain, so keep backup plans ready.");
    else recs.push("Rain risk is low, so outdoor plans should be relatively safe.");
  }

  if (uv != null) {
    if (uv >= 8) recs.push("UV is very strong — sunscreen and shade are strongly recommended.");
    else if (uv >= 5) recs.push("UV is moderate to high, so eye and skin protection may help.");
  }

  if (aqi != null) {
    if (aqi > 150) recs.push("Air quality is poor — reduce long outdoor exposure if possible.");
    else if (aqi > 80) recs.push("Air quality is moderate — sensitive people should be cautious.");
    else recs.push("Air quality looks acceptable for normal outdoor plans.");
  }

  if (humidity != null) {
    if (humidity >= 80) recs.push("Humidity is high, so it may feel sticky outdoors.");
    else if (humidity <= 30) recs.push("The air is dry — drinking enough water may help.");
  }

  if (wind != null && wind >= 30) {
    recs.push("It’s fairly windy — secure light items and expect breezy conditions.");
  }

  if (visibility != null) {
    if (visibility <= 2) recs.push("Visibility is poor — travel carefully if you’re driving.");
    else if (visibility <= 5) recs.push("Visibility is somewhat reduced, so extra caution may help during travel.");
  }

  if (cloud != null) {
    if (cloud >= 80) recs.push("Skies are heavily clouded, so sunlight will stay limited.");
    else if (cloud <= 20) recs.push("Skies are mostly clear — great for outdoor views and photos.");
  }

  if (thunder != null) {
    if (thunder >= 60) recs.push("Thunderstorm potential is high — avoid exposed outdoor areas if conditions worsen.");
    else if (thunder >= 30) recs.push("There is some thunderstorm risk, so keep an eye on changing conditions.");
  }

  if (sunset) {
    recs.push("Sunset is around " + sunset + ", so late-evening plans should account for fading daylight.");
  }

  var unique = [];
  var seen = {};
  for (var i = 0; i < recs.length; i++) {
    if (!seen[recs[i]]) {
      unique.push(recs[i]);
      seen[recs[i]] = true;
    }
  }

  if (!unique.length) {
    unique.push("Weather looks fairly stable right now, so normal plans should be comfortable.");
  }

  return unique.slice(0, 8);
}

/* ───── MAIN WEATHER ROUTE ───── */

app.get("/api/weather", async function (req, res) {
  try {
    var loc;
    if (req.query.lat != null || req.query.lon != null || req.query.city) {
      loc = await resolveLoc(req.query);
    } else {
      loc = await resolveIp();
    }

    var cKey = makeCK(loc.lat, loc.lon);
    var cached = getC(cKey);
    if (cached) {
      console.log("Cache hit:", loc.name);
      if (loc.name && loc.name !== "" && loc.name !== "Unknown location") {
        cached.location.name = loc.name;
        cached.location.region = loc.region;
        cached.location.country = loc.country;
      }
      return res.json(cached);
    }

    console.log("\n=== Fetching for:", loc.name, loc.lat, loc.lon, "===");

    var results = await Promise.all([
      fetchWeatherApi(loc),
      fetchTomorrowCurrent(loc),
      fetchWeatherbitCurrent(loc),
      fetchWeatherbitDaily(loc),
      fetchPirate(loc),
      fetchOpenWeather(loc),
      fetchOpenMeteoCurrent(loc),
      fetchOpenMeteoHourly(loc),
      fetchOpenMeteoDaily7(loc),
      fetchOpenMeteoStorm(loc),
      fetchAccuForecast(loc),
      fetchVisualCrossingMonthly(loc),
      fetchVisualCrossing7(loc),
      fetchMeteoblueCurrent(loc),
      fetchCheckWX(loc)
    ]);

    var waData = results[0];
    var tmCurrentData = results[1];
    var wbCurrent = results[2];
    var wbDaily = results[3];
    var prData = results[4];
    var owData = results[5];
    var omCurrentData = results[6];
    var omHourlyData = results[7];
    var omDaily7 = results[8];
    var omStormData = results[9];
    var accuData = results[10];
    var vcMonthlyData = results[11];
    var vc7 = results[12];
    var meteoblueData = results[13];
    var checkwxData = results[14];

    if (!waData) {
      return res.status(503).json({ error: "Primary weather API unavailable" });
    }

    var waCurr = waData.current || {};
    var waLoc = waData.location || {};
    var tz = waLoc.tz_id || (omCurrentData ? omCurrentData.timezone : null) || "UTC";

    var tmCurrent = parseTomorrowCurrent(tmCurrentData);
    var mbCurrent = parseMeteoblueCurrent(meteoblueData);
    var checkwxCeilingFeet = parseCheckWXCeiling(checkwxData);
    var accuPollen = parseAccuPollen(accuData);
    var omStorm = parseOpenMeteoStorm(omStormData);

    var currentTemp = first(
      omCurrentData && omCurrentData.current ? omCurrentData.current.temperature_2m : null,
      tmCurrent.temp,
      wbCurrent && wbCurrent.data && wbCurrent.data[0] ? first(wbCurrent.data[0].temp, wbCurrent.data[0].app_temp) : null,
      owData && owData.main ? owData.main.temp : null,
      waCurr.temp_c
    );

    var weatherCode = first(
      owData && owData.weather && owData.weather[0] ? owmCodeToWMO(owData.weather[0].id) : null,
      waCodeToWMO(waCurr.condition ? waCurr.condition.code : 1000)
    );

    var currentIsDay = first(waCurr.is_day, getIsDayNow(tz));

    var hourly = buildHourlyFromOpenMeteo(
      omHourlyData,
      currentTemp,
      weatherCode,
      tz
    );

    var timePeriods = buildTimePeriodsFromHourly(hourly, prData, tz);
    var dailyArray = buildDaily(accuData, omDaily7, wbDaily, vc7);
    var monthly = buildMonthly(vcMonthlyData, dailyArray);
    var pm25 = buildAQ(waData, wbDaily);

    var rainChance = null;
    if (prData && prData.currently && prData.currently.precipProbability != null) {
      rainChance = Math.round(prData.currently.precipProbability * 100);
    }
    if (rainChance == null && prData && prData.daily && prData.daily.data && prData.daily.data[0]) {
      if (prData.daily.data[0].precipProbability != null) {
        rainChance = Math.round(prData.daily.data[0].precipProbability * 100);
      }
    }
    if (rainChance == null && dailyArray.length) {
      rainChance = dailyArray[0].precip_chance;
    }

    var visibility = null;
    if (owData && owData.visibility != null) visibility = owData.visibility;
    if (visibility == null && waCurr.vis_km != null) visibility = waCurr.vis_km * 1000;

    var humidity = null;
    if (owData && owData.main && owData.main.humidity != null) humidity = owData.main.humidity;
    if (humidity == null) humidity = waCurr.humidity;

    var uv = first(
      waCurr.uv,
      wbDaily && wbDaily.data && wbDaily.data[0] ? first(wbDaily.data[0].uv, wbDaily.data[0].max_uv) : null,
      dailyArray.length ? dailyArray[0].uv : null
    );

    var realFeel = first(
      omCurrentData && omCurrentData.current ? omCurrentData.current.apparent_temperature : null,
      tmCurrent.feelsLike,
      waCurr.feelslike_c,
      owData && owData.main ? owData.main.feels_like : null
    );

    var stormProbability = computeStormProbability(
      first(omStorm.precipitation_probability, rainChance),
      first(mbCurrent.cloudCover, tmCurrent.cloudCover),
      omStorm.cape
    );

    var conditionText = getWeatherText(weatherCode, currentIsDay);

    var skyMetrics = {
      realfeel_shade: realFeel != null ? roundVal(realFeel - 3) : null,
      cloud_cover: roundVal(first(mbCurrent.cloudCover, tmCurrent.cloudCover)),
      cloud_base: checkwxCeilingFeet != null ? roundVal(checkwxCeilingFeet / 3280.84) : null,
      thunder_probability: stormProbability,
      dew_point: roundVal(tmCurrent.dewPoint),
      pollen_count: roundVal(accuPollen)
    };

    var dTime = [], dCode = [], dMax = [], dMin = [], dPrecip = [], dSunrise = [], dSunset = [], dUv = [];
    for (var i = 0; i < dailyArray.length; i++) {
      var dy = dailyArray[i];
      dTime.push(dy.date);
      dCode.push(dy.weather_code);
      dMax.push(dy.max_temp);
      dMin.push(dy.min_temp);
      dPrecip.push(dy.precip_chance);
      dSunrise.push(dy.sunrise);
      dSunset.push(dy.sunset);
      dUv.push(dy.uv);
    }

    if (waData && waData.forecast && waData.forecast.forecastday && waData.forecast.forecastday.length) {
      var wf = waData.forecast.forecastday;
      if (wf[0] && wf[0].astro) {
        dSunrise[0] = wf[0].date + "T" + c12to24(wf[0].astro.sunrise);
        dSunset[0] = wf[0].date + "T" + c12to24(wf[0].astro.sunset);
      }
      if (wf[1] && wf[1].astro) {
        dSunrise[1] = wf[1].date + "T" + c12to24(wf[1].astro.sunrise);
        dSunset[1] = wf[1].date + "T" + c12to24(wf[1].astro.sunset);
      }
    }

    var recommendations = buildRecommendations({
      currentTemp: roundVal(currentTemp),
      realFeel: roundVal(realFeel),
      rainChance: rainChance,
      uv: uv,
      aqi: pm25,
      humidity: humidity,
      wind: first(waCurr.wind_kph),
      visibilityKm: visibility != null ? visibility / 1000 : null,
      thunderProbability: stormProbability,
      cloudCover: first(mbCurrent.cloudCover, tmCurrent.cloudCover),
      sunsetText: dSunset[0] ? dSunset[0].substring(11, 16) : null
    });

    var result = {
      timezone: tz,
      location: {
        key: loc.key,
        name: loc.name || waLoc.name || "Unknown",
        region: loc.region || waLoc.region || "",
        country: loc.country || waLoc.country || "",
        latitude: loc.lat,
        longitude: loc.lon,
        timezone: tz
      },
      current: {
        temperature_c: roundVal(currentTemp),
        weather_code: weatherCode,
        condition_text: conditionText,
        is_day: currentIsDay,
        feelslike_c: roundVal(realFeel),
        humidity: humidity,
        wind_kph: first(waCurr.wind_kph),
        wind_degree: first(waCurr.wind_degree),
        pressure_hpa: first(waCurr.pressure_mb),
        visibility: visibility,
        rain_chance: rainChance,
        uv: uv,
        air_quality_pm25: pm25
      },
      sky_metrics: skyMetrics,
      recommendations: recommendations,
      time_periods: timePeriods,
      hourly: hourly,
      daily: {
        time: dTime,
        weather_code: dCode,
        temperature_2m_max: dMax,
        temperature_2m_min: dMin,
        precipitation_probability_max: dPrecip,
        sunrise: dSunrise,
        sunset: dSunset,
        uv_index_max: dUv
      },
      monthly: monthly
    };

    putC(cKey, result);
    res.json(result);
  } catch (e) {
    console.log("ERROR:", e);
    res.status(500).json({ error: "Failed" });
  }
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
  console.log("Server on http://localhost:" + PORT);
});