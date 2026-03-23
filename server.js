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

/* ───── CONVERTERS ───── */

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

/* ───── AQI / HELPERS ───── */

function buildAQ(waData, wbDaily) {
  var values = [];
  if (waData && waData.current && waData.current.air_quality) {
    var pm = waData.current.air_quality.pm2_5;
    if (pm != null && !isNaN(pm)) values.push(pm);
  }
  if (wbDaily && wbDaily.data && wbDaily.data[0]) {
    var aqi = wbDaily.data[0].aqi;
    if (aqi != null && !isNaN(aqi)) values.push(aqi * 0.3);
  }
  if (!values.length) return null;
  return Math.round((values.reduce(function (a, b) { return a + b; }, 0) / values.length) * 10) / 10;
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

async function fetchTomorrowHourly(loc) {
  if (!TOMORROW_KEY) return null;
  return await sf(
    "https://api.tomorrow.io/v4/timelines?location=" + loc.lat + "," + loc.lon +
      "&fields=temperature,weatherCode" +
      "&timesteps=1h&units=metric&apikey=" + TOMORROW_KEY,
    "Tomorrow-Hourly"
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

async function fetchOpenMeteoDaily7(loc) {
  return await sf(
    "https://api.open-meteo.com/v1/forecast?latitude=" + loc.lat +
      "&longitude=" + loc.lon +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max" +
      "&timezone=auto&forecast_days=7",
    "OpenMeteo-Daily7"
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

function parseTomorrowHourly(tmData, tz) {
  var out = {
    time: [],
    temperature_2m: [],
    weather_code: [],
    is_day: []
  };

  if (!tmData || !tmData.data || !tmData.data.timelines || !tmData.data.timelines.length) {
    return out;
  }

  var intervals = tmData.data.timelines[0].intervals || [];
  var nowEpoch = Math.floor(Date.now() / 1000);
  var count = 0;

  for (var i = 0; i < intervals.length && count < 8; i++) {
    var it = intervals[i];
    if (!it.startTime || !it.values) continue;

    var epoch = Math.floor(new Date(it.startTime).getTime() / 1000);
    if (epoch < nowEpoch - 3600) continue;

    var localStr = epochToLocalISO(epoch, tz);
    var localHour = parseInt(localStr.substring(11, 13));

    out.time.push(localStr);
    out.temperature_2m.push(roundVal(it.values.temperature));

    var wc = it.values.weatherCode;
    var mapped = 2;
    if (wc === 1000 || wc === 0) mapped = 0;
    else if (wc === 1100) mapped = 1;
    else if (wc === 1101) mapped = 2;
    else if (wc === 1102 || wc === 1001) mapped = 3;
    else if (wc === 2000 || wc === 2100) mapped = 45;
    else if (wc === 4000) mapped = 51;
    else if (wc === 4001) mapped = 63;
    else if (wc === 4200) mapped = 61;
    else if (wc === 4201) mapped = 65;
    else if (wc === 5000 || wc === 5100) mapped = 71;
    else if (wc === 5001 || wc === 5101) mapped = 75;
    else if (wc === 6000) mapped = 56;
    else if (wc === 6001 || wc === 6201) mapped = 67;
    else if (wc === 6200) mapped = 66;
    else if (wc === 7000 || wc === 7101 || wc === 7102) mapped = 77;
    else if (wc === 8000) mapped = 95;

    out.weather_code.push(mapped);
    out.is_day.push((localHour >= 6 && localHour < 18) ? 1 : 0);
    count++;
  }

  return out;
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

/* ───── HOURLY ───── */

function buildHourlyFromTomorrowAndPirate(tmHourly, prData, tz, currentTemp) {
  var time = [], temp = [], code = [], isDay = [];

  if (tmHourly && tmHourly.time && tmHourly.time.length) {
    for (var i = 0; i < tmHourly.time.length; i++) {
      time.push(tmHourly.time[i]);
      temp.push(tmHourly.temperature_2m[i]);
      code.push(tmHourly.weather_code[i]);
      isDay.push(tmHourly.is_day[i]);
    }
  }

  if (prData && prData.hourly && prData.hourly.data) {
    var existingKeys = {};
    for (var e = 0; e < time.length; e++) {
      existingKeys[time[e].substring(0, 13)] = true;
    }

    var ph = prData.hourly.data;
    var nowEpoch = Math.floor(Date.now() / 1000);

    for (var j = 0; j < ph.length && time.length < 24; j++) {
      var pEpoch = ph[j].time || 0;
      if (pEpoch < nowEpoch) continue;

      var localStr = epochToLocalISO(pEpoch, tz);
      var hourKey = localStr.substring(0, 13);
      if (existingKeys[hourKey]) continue;

      var localHour = parseInt(localStr.substring(11, 13));
      time.push(localStr);
      temp.push(roundVal(ph[j].temperature));
      code.push(pirateToWMO(ph[j].icon));
      isDay.push((localHour >= 6 && localHour < 18) ? 1 : 0);
      existingKeys[hourKey] = true;
    }
  }

  if (temp.length && currentTemp != null) {
    temp[0] = roundVal(currentTemp);
  }

  var combined = [];
  for (var k = 0; k < time.length; k++) {
    combined.push({
      time: time[k],
      temp: temp[k],
      code: code[k],
      isDay: isDay[k]
    });
  }
  combined.sort(function (a, b) { return a.time.localeCompare(b.time); });

  return {
    time: combined.map(function (c) { return c.time; }),
    temperature_2m: combined.map(function (c) { return c.temp; }),
    weather_code: combined.map(function (c) { return c.code; }),
    is_day: combined.map(function (c) { return c.isDay; })
  };
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
        temp: prData.hourly.data[p].temperature,
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

  // first 5 days from AccuWeather
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

  // days 6-7 blended
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

/* ───── ROUTES ───── */

app.get("/", function (req, res) {
  res.send("RealWeather backend running");
});

app.get("/api/search", async function (req, res) {
  try {
    var q = (req.query.q || "").trim();
    if (!q) return res.json({ results: [] });

    var wa = await sf("https://api.weatherapi.com/v1/search.json?key=" + WEATHERAPI_KEY + "&q=" + encodeURIComponent(q), "Search");
    if (wa && wa.length) {
      return res.json({
        results: wa.map(function (i) {
          return {
            name: i.name || "",
            region: i.region || "",
            country: i.country || "",
            latitude: i.lat,
            longitude: i.lon
          };
        })
      });
    }

    res.json({ results: [] });
  } catch (e) {
    console.log("SEARCH ERR:", e);
    res.status(500).json({ results: [] });
  }
});

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
      fetchTomorrowHourly(loc),
      fetchWeatherbitCurrent(loc),
      fetchWeatherbitDaily(loc),
      fetchPirate(loc),
      fetchOpenWeather(loc),
      fetchOpenMeteoCurrent(loc),
      fetchOpenMeteoDaily7(loc),
      fetchAccuForecast(loc),
      fetchVisualCrossingMonthly(loc),
      fetchVisualCrossing7(loc),
      fetchMeteoblueCurrent(loc)
    ]);

    var waData = results[0];
    var tmCurrentData = results[1];
    var tmHourlyData = results[2];
    var wbCurrent = results[3];
    var wbDaily = results[4];
    var prData = results[5];
    var owData = results[6];
    var omCurrentData = results[7];
    var omDaily7 = results[8];
    var accuData = results[9];
    var vcMonthlyData = results[10];
    var vc7 = results[11];
    var meteoblueData = results[12];

    console.log(
      "API Status — WA:", !!waData,
      "TM:", !!tmCurrentData,
      "TMH:", !!tmHourlyData,
      "WBC:", !!wbCurrent,
      "WBD:", !!wbDaily,
      "PR:", !!prData,
      "OW:", !!owData,
      "OMC:", !!omCurrentData,
      "OMD7:", !!omDaily7,
      "ACCU:", !!accuData,
      "VCM:", !!vcMonthlyData,
      "VC7:", !!vc7,
      "MB:", !!meteoblueData
    );

    if (!waData) {
      return res.status(503).json({ error: "Primary weather API unavailable" });
    }

    var waCurr = waData.current || {};
    var waLoc = waData.location || {};
    var tz = waLoc.tz_id || (omCurrentData ? omCurrentData.timezone : null) || "UTC";

    var tmCurrent = parseTomorrowCurrent(tmCurrentData);
    var tmHourly = parseTomorrowHourly(tmHourlyData, tz);
    var mbCurrent = parseMeteoblueCurrent(meteoblueData);

    var currentTemp = first(
      tmCurrent.temp,
      omCurrentData && omCurrentData.current ? omCurrentData.current.temperature_2m : null,
      wbCurrent && wbCurrent.data && wbCurrent.data[0] ? first(wbCurrent.data[0].temp, wbCurrent.data[0].app_temp) : null,
      owData && owData.main ? owData.main.temp : null,
      waCurr.temp_c
    );

    var hourly = buildHourlyFromTomorrowAndPirate(tmHourly, prData, tz, currentTemp);
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

    var uv = null;
    if (dailyArray.length && dailyArray[0].uv != null) uv = dailyArray[0].uv;
    if (uv == null && wbDaily && wbDaily.data && wbDaily.data[0]) uv = first(wbDaily.data[0].uv, wbDaily.data[0].max_uv);
    if (uv == null) uv = waCurr.uv;

    var realFeel = first(
      tmCurrent.feelsLike,
      omCurrentData && omCurrentData.current ? omCurrentData.current.apparent_temperature : null,
      waCurr.feelslike_c,
      owData && owData.main ? owData.main.feels_like : null
    );

    var skyMetrics = {
      realfeel_shade: realFeel != null ? roundVal(realFeel - 3) : null,
      cloud_cover: roundVal(first(mbCurrent.cloudCover, tmCurrent.cloudCover)),
      cloud_ceiling: roundVal(mbCurrent.cloudCeiling),
      thunder_probability: null,
      dew_point: roundVal(tmCurrent.dewPoint),
      pollen_count: roundVal(first(tmCurrent.treePollen, tmCurrent.grassPollen, tmCurrent.weedPollen))
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

    // daylight tracker from WeatherAPI sunrise/sunset
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
        weather_code: waCodeToWMO(waCurr.condition ? waCurr.condition.code : 1000),
        condition_text: waCurr.condition ? waCurr.condition.text : null,
        is_day: first(waCurr.is_day, 1),
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

    if (!result.location.name || result.location.name === "Unknown" || result.location.name === "") {
      if (waLoc.name) {
        result.location.name = waLoc.name;
        result.location.region = waLoc.region || "";
        result.location.country = waLoc.country || "";
      }
    }

    putC(cKey, result);

    console.log(
      "=== Done. Hourly:", hourly.time.length,
      "Daily:", dTime.length,
      "Monthly:", monthly.length,
      "CurrentTemp:", result.current.temperature_c,
      "RealFeel:", result.current.feelslike_c,
      "===\n"
    );

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