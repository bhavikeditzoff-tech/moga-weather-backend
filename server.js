require("dotenv").config();

const express = require("express");
const cors = require("cors");
const app = express();
app.use(cors());

const WEATHERAPI_KEY = process.env.WEATHERAPI_KEY;
const TOMORROW_KEY = process.env.TOMORROW_API_KEY;
const WEATHERBIT_KEY = process.env.WEATHERBIT_API_KEY;
const VISUALCROSSING_KEY = process.env.VISUAL_CROSSING_API_KEY;
const PIRATE_KEY = process.env.PIRATE_WEATHER_KEY;
const METEOSOURCE_KEY = process.env.METEOSOURCE_KEY;
const OPENWEATHER_KEY = process.env.OPENWEATHER_KEY;

/* ───── CACHE ───── */

var cache = {};
var CACHE_DURATION = 30 * 60 * 1000;

function ck(lat, lon) {
  return (Math.round(lat * 10) / 10) + "," + (Math.round(lon * 10) / 10);
}

function getC(key) {
  var e = cache[key];
  if (!e) return null;
  if (Date.now() - e.time > CACHE_DURATION) { delete cache[key]; return null; }
  return e.data;
}

function putC(key, data) {
  var keys = Object.keys(cache);
  if (keys.length > 300) {
    var sorted = keys.sort(function (a, b) { return (cache[a].time || 0) - (cache[b].time || 0); });
    for (var i = 0; i < 100; i++) delete cache[sorted[i]];
  }
  cache[key] = { data: data, time: Date.now() };
}

/* ───── HELPERS ───── */

function first() {
  for (var i = 0; i < arguments.length; i++) {
    var v = arguments[i];
    if (v !== undefined && v !== null && v !== "" && !Number.isNaN(v)) return v;
  }
  return null;
}

function sf(url, label) {
  return fetch(url)
    .then(function (r) {
      if (!r.ok) {
        return r.text().catch(function () { return ""; }).then(function (t) {
          console.log(label + " HTTP " + r.status + ": " + t.substring(0, 200));
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
  var p = t.split(" "), tp = p[0].split(":"), h = tp[0], m = tp[1], mod = p[1];
  if (h === "12") h = "00";
  if (mod === "PM") h = String(parseInt(h, 10) + 12);
  return h.padStart(2, "0") + ":" + m + ":00";
}

function nearIdx(arr) {
  if (!arr || !arr.length) return 0;
  var now = Date.now(), idx = 0, best = Infinity;
  for (var i = 0; i < arr.length; i++) {
    var d = Math.abs(now - new Date(arr[i]).getTime());
    if (!isNaN(d) && d < best) { best = d; idx = i; }
  }
  return idx;
}

/* ───── CODE CONVERTERS ───── */

function waCodeToWMO(c) {
  var m = { 1000: 0, 1003: 2, 1006: 3, 1009: 3, 1030: 45, 1063: 61, 1066: 71, 1069: 66, 1072: 56, 1087: 95, 1114: 73, 1117: 75, 1135: 45, 1147: 48, 1150: 51, 1153: 51, 1168: 56, 1171: 57, 1180: 61, 1183: 61, 1186: 63, 1189: 63, 1192: 65, 1195: 65, 1198: 66, 1201: 67, 1204: 66, 1207: 67, 1210: 71, 1213: 71, 1216: 73, 1219: 73, 1222: 75, 1225: 75, 1237: 77, 1240: 80, 1243: 81, 1246: 82, 1249: 85, 1252: 86, 1255: 85, 1258: 86, 1261: 77, 1264: 77, 1273: 95, 1276: 95, 1279: 95, 1282: 96 };
  return m[c] !== undefined ? m[c] : 0;
}

function tmCodeToWMO(code) {
  if (code == null) return 0;
  var map = { 0: 0, 1000: 0, 1100: 1, 1101: 2, 1102: 3, 1001: 3, 2000: 45, 2100: 45, 4000: 51, 4001: 63, 4200: 61, 4201: 65, 5000: 73, 5001: 75, 5100: 71, 5101: 75, 6000: 56, 6001: 67, 6200: 66, 6201: 67, 7000: 77, 7101: 77, 7102: 77, 8000: 95 };
  return map[code] !== undefined ? map[code] : 0;
}

function vcToWMO(icon) {
  if (!icon) return 0;
  var i = icon.toLowerCase();
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

function wbCodeToWMO(c) {
  if (!c) return 0;
  if (c >= 200 && c < 300) return 95;
  if (c >= 300 && c < 400) return 51;
  if (c >= 500 && c < 600) return 63;
  if (c >= 600 && c < 700) return 73;
  if (c >= 700 && c < 800) return 45;
  if (c === 800) return 0;
  if (c === 801) return 1;
  if (c === 802) return 2;
  if (c >= 803) return 3;
  return 0;
}

function msToWMO(iconOrId) {
  if (!iconOrId) return 0;
  // Meteosource can return icon number or string
  if (typeof iconOrId === "number") {
    if (iconOrId <= 2) return 0;
    if (iconOrId <= 4) return 2;
    if (iconOrId <= 6) return 3;
    if (iconOrId === 7) return 45;
    if (iconOrId <= 10) return 61;
    if (iconOrId <= 13) return 63;
    if (iconOrId <= 17) return 65;
    if (iconOrId <= 20) return 73;
    if (iconOrId <= 23) return 95;
    return 2;
  }
  // String icon
  var s = String(iconOrId).toLowerCase();
  if (s.indexOf("clear") >= 0 || s.indexOf("sunny") >= 0) return 0;
  if (s.indexOf("partly") >= 0) return 2;
  if (s.indexOf("cloud") >= 0 || s.indexOf("overcast") >= 0) return 3;
  if (s.indexOf("fog") >= 0) return 45;
  if (s.indexOf("thunder") >= 0) return 95;
  if (s.indexOf("snow") >= 0) return 73;
  if (s.indexOf("rain") >= 0 || s.indexOf("drizzle") >= 0) return 63;
  return 2;
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

/* ───── LOCATION ───── */

var PRESETS = {
  moga: { key: "moga", name: "Moga", region: "Punjab", country: "India", lat: 30.8165, lon: 75.1717 }
};

async function resolveLoc(q) {
  var city = (q.city || "").trim(), ckey = city.toLowerCase();
  var lat = q.lat != null ? Number(q.lat) : null;
  var lon = q.lon != null ? Number(q.lon) : null;

  if (lat != null && lon != null && !isNaN(lat) && !isNaN(lon)) {
    var r = await sf("https://api.weatherapi.com/v1/search.json?key=" + WEATHERAPI_KEY + "&q=" + lat + "," + lon, "RevGeo");
    if (r && r.length) return { key: "coords", name: r[0].name || "", region: r[0].region || "", country: r[0].country || "", lat: lat, lon: lon };
    return { key: "coords", name: "", region: "", country: "", lat: lat, lon: lon };
  }

  if (ckey && PRESETS[ckey]) return PRESETS[ckey];

  if (city) {
    var wa = await sf("https://api.weatherapi.com/v1/search.json?key=" + WEATHERAPI_KEY + "&q=" + encodeURIComponent(city), "WA-Geo");
    if (wa && wa.length) return { key: ckey, name: wa[0].name || city, region: wa[0].region || "", country: wa[0].country || "", lat: wa[0].lat, lon: wa[0].lon };
  }

  return PRESETS.moga;
}

async function resolveIp() {
  var g = await sf("https://ipapi.co/json/", "IPAPI");
  if (!g || !g.latitude) return PRESETS.moga;
  return { key: "ip", name: g.city || "Unknown", region: g.region || "", country: g.country_name || "", lat: Number(g.latitude), lon: Number(g.longitude) };
}

/* ───── FETCHERS ───── */

async function fetchWeatherApi(loc) {
  return await sf("https://api.weatherapi.com/v1/forecast.json?key=" + WEATHERAPI_KEY + "&q=" + loc.lat + "," + loc.lon + "&days=3&aqi=yes&alerts=no", "WeatherAPI");
}

async function fetchTomorrow(loc) {
  var url = "https://api.tomorrow.io/v4/timelines?location=" + loc.lat + "," + loc.lon +
    "&fields=temperature,temperatureApparent,weatherCode,precipitationProbability,windSpeed" +
    "&timesteps=1h&units=metric&apikey=" + TOMORROW_KEY;
  return await sf(url, "Tomorrow");
}

async function fetchPirate(loc) {
  return await sf("https://api.pirateweather.net/forecast/" + PIRATE_KEY + "/" + loc.lat + "," + loc.lon + "?units=si&exclude=minutely,alerts", "Pirate");
}

async function fetchWeatherbit(loc) {
  return await sf("https://api.weatherbit.io/v2.0/forecast/daily?lat=" + loc.lat + "&lon=" + loc.lon + "&days=7&key=" + WEATHERBIT_KEY, "Weatherbit");
}

async function fetchMeteosource(loc) {
  return await sf("https://www.meteosource.com/api/v1/free/point?lat=" + loc.lat + "&lon=" + loc.lon + "&sections=daily&key=" + METEOSOURCE_KEY, "Meteosource");
}

async function fetchOpenWeather(loc) {
  return await sf("https://api.openweathermap.org/data/2.5/weather?lat=" + loc.lat + "&lon=" + loc.lon + "&appid=" + OPENWEATHER_KEY + "&units=metric", "OpenWeather");
}

async function fetchVisualCrossing(loc) {
  var now = new Date();
  var y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, "0");
  var monthStart = y + "-" + m + "-01";
  var endDate = new Date(now);
  endDate.setDate(endDate.getDate() + 15);
  var endStr = endDate.toISOString().split("T")[0];
  return await sf("https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/" + loc.lat + "," + loc.lon + "/" + monthStart + "/" + endStr + "?key=" + VISUALCROSSING_KEY + "&unitGroup=metric&include=days&iconSet=icons1", "VisualCrossing");
}

async function fetchOpenMeteo(loc) {
  return await sf("https://api.open-meteo.com/v1/forecast?latitude=" + loc.lat + "&longitude=" + loc.lon + "&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=16", "OpenMeteo");
}

/* ───── PARSE TOMORROW.IO HOURLY ───── */

function parseTomorrowHourly(tmData) {
  var hours = [];
  if (!tmData) return hours;

  // Try v4/timelines format
  if (tmData.data && tmData.data.timelines) {
    var timelines = tmData.data.timelines;
    for (var t = 0; t < timelines.length; t++) {
      var intervals = timelines[t].intervals || [];
      for (var i = 0; i < intervals.length; i++) {
        var iv = intervals[i];
        var vals = iv.values || {};
        hours.push({
          time: iv.startTime,
          temp: first(vals.temperature, vals.temperatureApparent),
          code: tmCodeToWMO(vals.weatherCode),
          precip: vals.precipitationProbability,
          windSpeed: vals.windSpeed,
          feelsLike: vals.temperatureApparent
        });
      }
    }
  }

  // Try v4/weather/forecast format
  if (hours.length === 0 && tmData.timelines && tmData.timelines.hourly) {
    var th = tmData.timelines.hourly;
    for (var j = 0; j < th.length; j++) {
      var v = th[j].values || {};
      hours.push({
        time: th[j].time,
        temp: first(v.temperature, v.temperatureApparent),
        code: tmCodeToWMO(v.weatherCode),
        precip: v.precipitationProbability,
        windSpeed: v.windSpeed,
        feelsLike: v.temperatureApparent
      });
    }
  }

  return hours;
}

/* ───── PARSE PIRATE WEATHER HOURLY ───── */

function parsePirateHourly(prData) {
  var hours = [];
  if (!prData || !prData.hourly || !prData.hourly.data) return hours;

  var ph = prData.hourly.data;
  for (var i = 0; i < ph.length; i++) {
    var h = ph[i];
    var timeMs = (h.time || 0) * 1000;
    hours.push({
      time: new Date(timeMs).toISOString(),
      temp: h.temperature,
      code: pirateToWMO(h.icon),
      precip: h.precipProbability != null ? Math.round(h.precipProbability * 100) : null,
      windSpeed: h.windSpeed
    });
  }

  return hours;
}

/* ───── BUILD HOURLY (MERGED) ───── */

function buildHourly(tmData, prData) {
  var tmHours = parseTomorrowHourly(tmData);
  var prHours = parsePirateHourly(prData);
  var now = new Date();
  var nowMs = now.getTime();
  var allHours = [];

  console.log("Tomorrow hours parsed:", tmHours.length);
  console.log("Pirate hours parsed:", prHours.length);

  // Add Tomorrow.io hours (first 7 future hours)
  var tmCount = 0;
  for (var i = 0; i < tmHours.length; i++) {
    var t = new Date(tmHours[i].time).getTime();
    if (t >= nowMs - 3600000 && tmCount < 7) {
      allHours.push(tmHours[i]);
      tmCount++;
    }
  }

  // Add Pirate hours for remaining (up to 24 total)
  for (var j = 0; j < prHours.length && allHours.length < 24; j++) {
    var pt = new Date(prHours[j].time).getTime();
    if (pt < nowMs - 3600000) continue;

    // Check if this hour already exists from Tomorrow
    var exists = false;
    for (var k = 0; k < allHours.length; k++) {
      if (Math.abs(new Date(allHours[k].time).getTime() - pt) < 1800000) {
        exists = true;
        break;
      }
    }
    if (!exists) allHours.push(prHours[j]);
  }

  // If still empty, try WeatherAPI hourly as last resort
  allHours.sort(function (a, b) { return new Date(a.time) - new Date(b.time); });

  // Convert to arrays
  var time = [], temp = [], code = [], isDay = [];
  for (var h = 0; h < allHours.length; h++) {
    var hr = new Date(allHours[h].time);
    time.push(allHours[h].time);
    temp.push(allHours[h].temp);
    code.push(allHours[h].code || 0);
    isDay.push((hr.getHours() >= 6 && hr.getHours() < 18) ? 1 : 0);
  }

  return { time: time, temperature_2m: temp, weather_code: code, is_day: isDay };
}

/* ───── BUILD HOURLY FROM WEATHERAPI (FALLBACK) ───── */

function buildHourlyFromWA(waData) {
  var time = [], temp = [], code = [], isDay = [];
  if (!waData || !waData.forecast || !waData.forecast.forecastday) return { time: time, temperature_2m: temp, weather_code: code, is_day: isDay };

  var days = waData.forecast.forecastday;
  var now = Date.now();

  for (var d = 0; d < days.length; d++) {
    var hours = days[d].hour || [];
    for (var h = 0; h < hours.length; h++) {
      var hr = hours[h];
      var hrTime = new Date(hr.time.replace(" ", "T"));
      if (hrTime.getTime() >= now - 3600000) {
        time.push(hr.time.replace(" ", "T"));
        temp.push(hr.temp_c);
        code.push(waCodeToWMO(hr.condition ? hr.condition.code : 1000));
        isDay.push(hr.is_day);
      }
    }
  }

  return { time: time, temperature_2m: temp, weather_code: code, is_day: isDay };
}

/* ───── BUILD TIME PERIODS ───── */

function buildTimePeriods(allHourlyData) {
  if (!allHourlyData || !allHourlyData.time || !allHourlyData.time.length) {
    return [
      { name: "Morning", temp: null, weather_code: 0, precip_chance: null, has_data: false },
      { name: "Afternoon", temp: null, weather_code: 0, precip_chance: null, has_data: false },
      { name: "Evening", temp: null, weather_code: 0, precip_chance: null, has_data: false },
      { name: "Overnight", temp: null, weather_code: 0, precip_chance: null, has_data: false }
    ];
  }

  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var tomorrow = new Date(today.getTime() + 86400000);

  var periods = [
    { name: "Morning", startH: 6, endH: 12 },
    { name: "Afternoon", startH: 12, endH: 17 },
    { name: "Evening", startH: 17, endH: 21 },
    { name: "Overnight", startH: 21, endH: 30 }
  ];

  var result = [];

  for (var p = 0; p < periods.length; p++) {
    var period = periods[p];
    var baseDay = today;

    var startTime = new Date(baseDay.getTime() + period.startH * 3600000);
    var endTime;
    if (period.endH <= 24) {
      endTime = new Date(baseDay.getTime() + period.endH * 3600000);
    } else {
      endTime = new Date(baseDay.getTime() + (period.endH) * 3600000);
    }

    // If period already passed, shift to tomorrow
    if (endTime < now) {
      startTime = new Date(startTime.getTime() + 86400000);
      endTime = new Date(endTime.getTime() + 86400000);
    }

    var temps = [], codes = {}, precips = [];

    for (var i = 0; i < allHourlyData.time.length; i++) {
      var ht = new Date(allHourlyData.time[i]);
      if (ht >= startTime && ht < endTime) {
        if (allHourlyData.temperature_2m[i] != null) temps.push(allHourlyData.temperature_2m[i]);
        var c = allHourlyData.weather_code[i];
        if (c != null) codes[c] = (codes[c] || 0) + 1;
      }
    }

    // Get precip from pirate/tomorrow parsed data
    // We already have it in the hourly data, but it wasn't stored
    // Use the temps length as indicator of data

    var avgTemp = temps.length ? Math.round(temps.reduce(function (a, b) { return a + b; }, 0) / temps.length) : null;

    var dominantCode = 0, maxCount = 0;
    var codeKeys = Object.keys(codes);
    for (var ci = 0; ci < codeKeys.length; ci++) {
      if (codes[codeKeys[ci]] > maxCount) {
        maxCount = codes[codeKeys[ci]];
        dominantCode = Number(codeKeys[ci]);
      }
    }

    result.push({
      name: period.name,
      temp: avgTemp,
      weather_code: dominantCode,
      precip_chance: null, // Will be filled below
      has_data: temps.length > 0
    });
  }

  return result;
}

/* ───── ADD PRECIP TO TIME PERIODS ───── */

function addPrecipToTimePeriods(periods, tmHours, prHours) {
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  var periodDefs = [
    { startH: 6, endH: 12 },
    { startH: 12, endH: 17 },
    { startH: 17, endH: 21 },
    { startH: 21, endH: 30 }
  ];

  var allPrecipHours = [];
  for (var i = 0; i < tmHours.length; i++) {
    if (tmHours[i].precip != null) allPrecipHours.push({ time: tmHours[i].time, precip: tmHours[i].precip });
  }
  for (var j = 0; j < prHours.length; j++) {
    if (prHours[j].precip != null) allPrecipHours.push({ time: prHours[j].time, precip: prHours[j].precip });
  }

  for (var p = 0; p < periods.length && p < periodDefs.length; p++) {
    var def = periodDefs[p];
    var startTime = new Date(today.getTime() + def.startH * 3600000);
    var endTime = new Date(today.getTime() + (def.endH > 24 ? def.endH : def.endH) * 3600000);

    if (endTime < now) {
      startTime = new Date(startTime.getTime() + 86400000);
      endTime = new Date(endTime.getTime() + 86400000);
    }

    var precips = [];
    for (var h = 0; h < allPrecipHours.length; h++) {
      var ht = new Date(allPrecipHours[h].time);
      if (ht >= startTime && ht < endTime) {
        precips.push(allPrecipHours[h].precip);
      }
    }

    if (precips.length > 0) {
      periods[p].precip_chance = Math.round(precips.reduce(function (a, b) { return a + b; }, 0) / precips.length);
    }
  }

  return periods;
}

/* ───── BUILD DAILY (15 DAYS) ───── */

function buildDaily(waData, wbData, msData, vcData, omData) {
  var days = {};
  var now = new Date();
  var todayStr = now.toISOString().split("T")[0];

  // Step 1: WeatherAPI days 1-3 (conditions + sunrise/sunset)
  if (waData && waData.forecast && waData.forecast.forecastday) {
    var waDays = waData.forecast.forecastday;
    for (var i = 0; i < waDays.length; i++) {
      var d = waDays[i];
      var dd = d.day || {};
      var astro = d.astro || {};
      days[d.date] = {
        date: d.date,
        weather_code: waCodeToWMO(dd.condition ? dd.condition.code : 1000),
        max_temp: null,
        min_temp: null,
        precip_chance: dd.daily_chance_of_rain || dd.daily_chance_of_snow || 0,
        sunrise: d.date + "T" + c12to24(astro.sunrise),
        sunset: d.date + "T" + c12to24(astro.sunset),
        uv: null,
        source_condition: "wa"
      };
    }
  }

  // Step 2: Weatherbit days 1-7 (temperatures + UV)
  if (wbData && wbData.data) {
    for (var j = 0; j < wbData.data.length; j++) {
      var wb = wbData.data[j];
      var wbDate = wb.datetime || wb.valid_date;
      if (!wbDate) continue;

      // Get temperatures - weatherbit uses different field names
      var wbMax = first(wb.max_temp, wb.high_temp, wb.app_max_temp);
      var wbMin = first(wb.min_temp, wb.low_temp, wb.app_min_temp);
      var wbUv = first(wb.uv, wb.max_uv);

      if (days[wbDate]) {
        // Fill in temps for existing days (1-3)
        days[wbDate].max_temp = wbMax;
        days[wbDate].min_temp = wbMin;
        days[wbDate].uv = wbUv;
        if (!days[wbDate].precip_chance) {
          days[wbDate].precip_chance = wb.pop || 0;
        }
      } else {
        // Days 4-7: Weatherbit provides temps, use its conditions as default
        var wbWxCode = wb.weather && wb.weather.code ? wbCodeToWMO(wb.weather.code) : 0;
        days[wbDate] = {
          date: wbDate,
          weather_code: wbWxCode,
          max_temp: wbMax,
          min_temp: wbMin,
          precip_chance: wb.pop || 0,
          sunrise: null,
          sunset: null,
          uv: wbUv,
          source_condition: "wb"
        };
      }
    }
  }

  // Step 3: Meteosource conditions for days 4-7 (override weatherbit conditions)
  if (msData && msData.daily && msData.daily.data) {
    var msDays = msData.daily.data;
    for (var m = 0; m < msDays.length; m++) {
      var ms = msDays[m];
      var msDate = ms.day;
      if (!msDate) continue;

      // Get condition from meteosource
      var msCode = 0;
      if (ms.icon != null) {
        msCode = msToWMO(ms.icon);
      } else if (ms.weather != null) {
        msCode = msToWMO(ms.weather);
      } else if (ms.summary) {
        msCode = msToWMO(ms.summary);
      }

      if (days[msDate]) {
        // Only override conditions for days 4+ (keep WeatherAPI for days 1-3)
        if (days[msDate].source_condition !== "wa") {
          days[msDate].weather_code = msCode;
          days[msDate].source_condition = "ms";
        }
      } else {
        // New day from meteosource
        var msMax = null, msMin = null;
        if (ms.all_day) {
          msMax = first(ms.all_day.temperature_max, ms.all_day.temperature);
          msMin = first(ms.all_day.temperature_min, ms.all_day.temperature);
        }
        days[msDate] = {
          date: msDate,
          weather_code: msCode,
          max_temp: msMax,
          min_temp: msMin,
          precip_chance: ms.all_day ? (ms.all_day.precipitation ? ms.all_day.precipitation.total : 0) : 0,
          sunrise: null,
          sunset: null,
          uv: null,
          source_condition: "ms"
        };
      }
    }
  }

  // Step 4: Visual Crossing for days 8-15 (conditions + sunrise/sunset)
  if (vcData && vcData.days) {
    for (var v = 0; v < vcData.days.length; v++) {
      var vc = vcData.days[v];
      if (!vc.datetime) continue;

      if (!days[vc.datetime]) {
        // New day from Visual Crossing (days 8-15)
        days[vc.datetime] = {
          date: vc.datetime,
          weather_code: vcToWMO(vc.icon || vc.conditions || ""),
          max_temp: vc.tempmax,
          min_temp: vc.tempmin,
          precip_chance: vc.precipprob || 0,
          sunrise: vc.sunrise ? vc.datetime + "T" + vc.sunrise : null,
          sunset: vc.sunset ? vc.datetime + "T" + vc.sunset : null,
          uv: vc.uvindex,
          source_condition: "vc"
        };
      } else {
        // Fill in missing sunrise/sunset for existing days
        if (!days[vc.datetime].sunrise && vc.sunrise) {
          days[vc.datetime].sunrise = vc.datetime + "T" + vc.sunrise;
        }
        if (!days[vc.datetime].sunset && vc.sunset) {
          days[vc.datetime].sunset = vc.datetime + "T" + vc.sunset;
        }
        // Fill in missing UV
        if (!days[vc.datetime].uv && vc.uvindex != null) {
          days[vc.datetime].uv = vc.uvindex;
        }
      }
    }
  }

  // Step 5: Open-Meteo temps for days 8-15 (override Visual Crossing temps)
  if (omData && omData.daily && omData.daily.time) {
    var omd = omData.daily;
    for (var o = 0; o < omd.time.length; o++) {
      var omDate = omd.time[o];
      if (days[omDate]) {
        // For days 8+, override with Open-Meteo temps (more accurate)
        if (days[omDate].source_condition === "vc") {
          if (omd.temperature_2m_max && omd.temperature_2m_max[o] != null) {
            days[omDate].max_temp = omd.temperature_2m_max[o];
          }
          if (omd.temperature_2m_min && omd.temperature_2m_min[o] != null) {
            days[omDate].min_temp = omd.temperature_2m_min[o];
          }
        }
      } else {
        // Brand new day not covered by other APIs
        days[omDate] = {
          date: omDate,
          weather_code: 0,
          max_temp: omd.temperature_2m_max ? omd.temperature_2m_max[o] : null,
          min_temp: omd.temperature_2m_min ? omd.temperature_2m_min[o] : null,
          precip_chance: 0,
          sunrise: null,
          sunset: null,
          uv: null,
          source_condition: "om"
        };
      }
    }
  }

  // Sort and limit to 15 days from today
  var sorted = Object.values(days).sort(function (a, b) {
    return new Date(a.date) - new Date(b.date);
  });

  var filtered = sorted.filter(function (d) { return d.date >= todayStr; });
  return filtered.slice(0, 15);
}

/* ───── BUILD MONTHLY ───── */

function buildMonthly(vcData) {
  var monthly = [];
  if (!vcData || !vcData.days) return monthly;

  for (var i = 0; i < vcData.days.length; i++) {
    var d = vcData.days[i];
    if (!d.datetime) continue;
    monthly.push({
      date: d.datetime,
      weather_code: vcToWMO(d.icon || d.conditions || ""),
      max_temp: d.tempmax != null ? d.tempmax : null,
      min_temp: d.tempmin != null ? d.tempmin : null
    });
  }

  return monthly;
}

/* ───── BUILD AIR QUALITY ───── */

function buildAQ(waData, wbData, owmData) {
  var values = [];

  if (waData && waData.current && waData.current.air_quality) {
    var waPm = waData.current.air_quality.pm2_5;
    if (waPm != null && !isNaN(waPm)) values.push(waPm);
  }

  if (wbData && wbData.data && wbData.data[0]) {
    var wbAqi = wbData.data[0].aqi;
    if (wbAqi != null && !isNaN(wbAqi)) values.push(wbAqi * 0.3);
  }

  if (values.length === 0) return null;
  return Math.round((values.reduce(function (a, b) { return a + b; }, 0) / values.length) * 10) / 10;
}

/* ───── ROUTES ───── */

app.get("/", function (req, res) { res.send("RealWeather backend running"); });

app.get("/api/search", async function (req, res) {
  try {
    var q = (req.query.q || "").trim();
    if (!q) return res.json({ results: [] });

    var wa = await sf("https://api.weatherapi.com/v1/search.json?key=" + WEATHERAPI_KEY + "&q=" + encodeURIComponent(q), "Search");
    if (wa && wa.length) {
      return res.json({
        results: wa.map(function (i) {
          return { name: i.name || "", region: i.region || "", country: i.country || "", latitude: i.lat, longitude: i.lon };
        })
      });
    }

    var om = await sf("https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(q) + "&count=8&language=en&format=json", "OM-Search");
    if (om && om.results) {
      return res.json({
        results: om.results.map(function (i) {
          return { name: i.name || "", region: i.admin1 || "", country: i.country || "", latitude: i.latitude, longitude: i.longitude };
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

    var cacheKey = ck(loc.lat, loc.lon);
    var cached = getC(cacheKey);
    if (cached) {
      console.log("Cache hit:", loc.name);
      if (loc.name && loc.name !== "" && loc.name !== "Unknown location") {
        cached.location.name = loc.name;
        cached.location.region = loc.region;
        cached.location.country = loc.country;
      }
      return res.json(cached);
    }

    console.log("Fetching for:", loc.name, loc.lat, loc.lon);

    var results = await Promise.all([
      fetchWeatherApi(loc),
      fetchTomorrow(loc),
      fetchPirate(loc),
      fetchWeatherbit(loc),
      fetchMeteosource(loc),
      fetchOpenWeather(loc),
      fetchVisualCrossing(loc),
      fetchOpenMeteo(loc)
    ]);

    var waData = results[0];
    var tmData = results[1];
    var prData = results[2];
    var wbData = results[3];
    var msData = results[4];
    var owData = results[5];
    var vcData = results[6];
    var omData = results[7];

    console.log("WA:", waData ? "OK" : "FAIL",
      "TM:", tmData ? "OK" : "FAIL",
      "PR:", prData ? "OK" : "FAIL",
      "WB:", wbData ? "OK" : "FAIL",
      "MS:", msData ? "OK" : "FAIL",
      "OW:", owData ? "OK" : "FAIL",
      "VC:", vcData ? "OK" : "FAIL",
      "OM:", omData ? "OK" : "FAIL");

    if (!waData && !tmData && !prData) {
      return res.status(503).json({ error: "Weather APIs unavailable" });
    }

    // Parse hourly sources
    var tmHours = parseTomorrowHourly(tmData);
    var prHours = parsePirateHourly(prData);

    // Build hourly
    var hourly = buildHourly(tmData, prData);

    // If hourly is still empty, fallback to WeatherAPI
    if (!hourly.time.length && waData) {
      console.log("Hourly empty, falling back to WeatherAPI hourly");
      hourly = buildHourlyFromWA(waData);
    }

    // Build time periods from merged hourly data
    var timePeriods = buildTimePeriods(hourly);
    timePeriods = addPrecipToTimePeriods(timePeriods, tmHours, prHours);

    // Build daily
    var dailyArray = buildDaily(waData, wbData, msData, vcData, omData);

    // Build monthly
    var monthly = buildMonthly(vcData);

    // Build air quality
    var blendedPm25 = buildAQ(waData, wbData, owData);

    // Current conditions
    var waCurr = waData ? waData.current || {} : {};
    var waLoc = waData ? waData.location || {} : {};

    // Tomorrow.io current values
    var tmFeelsLike = null, tmWindKph = null;
    if (tmHours.length > 0) {
      tmFeelsLike = tmHours[0].feelsLike;
      tmWindKph = tmHours[0].windSpeed != null ? tmHours[0].windSpeed * 3.6 : null;
    }

    // Pirate current
    var prCurr = prData && prData.currently ? prData.currently : {};
    var prRainChance = prCurr.precipProbability != null ? Math.round(prCurr.precipProbability * 100) : null;

    // Pirate daily rain chance (more reliable)
    if (prRainChance == null && prData && prData.daily && prData.daily.data && prData.daily.data[0]) {
      var prDay = prData.daily.data[0];
      prRainChance = prDay.precipProbability != null ? Math.round(prDay.precipProbability * 100) : null;
    }

    // Weatherbit UV
    var wbUv = wbData && wbData.data && wbData.data[0] ? first(wbData.data[0].uv, wbData.data[0].max_uv) : null;

    // OpenWeather values
    var owHumidity = owData && owData.main ? owData.main.humidity : null;
    var owVisibility = owData ? owData.visibility : null;

    // Build daily arrays
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

    var result = {
      timezone: waLoc.tz_id || (omData ? omData.timezone : null) || "UTC",

      location: {
        key: loc.key,
        name: loc.name || waLoc.name || "Unknown",
        region: loc.region || waLoc.region || "",
        country: loc.country || waLoc.country || "",
        latitude: loc.lat,
        longitude: loc.lon,
        timezone: waLoc.tz_id || "UTC"
      },

      current: {
        temperature_c: first(waCurr.temp_c),
        weather_code: waCodeToWMO(waCurr.condition ? waCurr.condition.code : 1000),
        condition_text: waCurr.condition ? waCurr.condition.text : null,
        is_day: first(waCurr.is_day, 1),
        feelslike_c: first(tmFeelsLike, waCurr.feelslike_c),
        humidity: first(owHumidity, waCurr.humidity),
        wind_kph: first(tmWindKph, waCurr.wind_kph),
        wind_degree: first(waCurr.wind_degree),
        pressure_hpa: first(waCurr.pressure_mb),
        visibility: first(owVisibility),
        rain_chance: first(prRainChance),
        uv: first(wbUv, waCurr.uv),
        air_quality_pm25: blendedPm25
      },

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

    // Fix location name
    if (!result.location.name || result.location.name === "Unknown" || result.location.name === "") {
      if (waLoc.name) {
        result.location.name = waLoc.name;
        result.location.region = waLoc.region || "";
        result.location.country = waLoc.country || "";
      }
    }

    putC(cacheKey, result);

    console.log("Done. Hourly:", hourly.time.length,
      "Daily:", dTime.length,
      "Monthly:", monthly.length,
      "Periods:", timePeriods.filter(function (p) { return p.has_data; }).length + "/4");

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