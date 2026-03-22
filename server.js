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

function makeCK(lat, lon) {
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
          console.log(label + " HTTP " + r.status + ": " + t.substring(0, 300));
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

function msToWMO(val) {
  if (!val) return 0;
  if (typeof val === "number") {
    if (val <= 2) return 0;
    if (val <= 4) return 2;
    if (val <= 6) return 3;
    if (val === 7) return 45;
    if (val <= 10) return 61;
    if (val <= 13) return 63;
    if (val <= 17) return 65;
    if (val <= 20) return 73;
    if (val <= 23) return 95;
    return 2;
  }
  var s = String(val).toLowerCase();
  if (s.indexOf("clear") >= 0 || s.indexOf("sunny") >= 0) return 0;
  if (s.indexOf("partly") >= 0) return 2;
  if (s.indexOf("cloud") >= 0) return 3;
  if (s.indexOf("fog") >= 0) return 45;
  if (s.indexOf("thunder") >= 0) return 95;
  if (s.indexOf("snow") >= 0) return 73;
  if (s.indexOf("rain") >= 0) return 63;
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

async function fetchPirate(loc) {
  if (!PIRATE_KEY) return null;
  return await sf("https://api.pirateweather.net/forecast/" + PIRATE_KEY + "/" + loc.lat + "," + loc.lon + "?units=si&exclude=minutely,alerts", "Pirate");
}

async function fetchWeatherbit(loc) {
  if (!WEATHERBIT_KEY) return null;
  return await sf("https://api.weatherbit.io/v2.0/forecast/daily?lat=" + loc.lat + "&lon=" + loc.lon + "&days=7&key=" + WEATHERBIT_KEY, "Weatherbit");
}

async function fetchMeteosource(loc) {
  if (!METEOSOURCE_KEY) return null;
  return await sf("https://www.meteosource.com/api/v1/free/point?lat=" + loc.lat + "&lon=" + loc.lon + "&sections=daily&key=" + METEOSOURCE_KEY, "Meteosource");
}

async function fetchOpenWeather(loc) {
  if (!OPENWEATHER_KEY) return null;
  return await sf("https://api.openweathermap.org/data/2.5/weather?lat=" + loc.lat + "&lon=" + loc.lon + "&appid=" + OPENWEATHER_KEY + "&units=metric", "OpenWeather");
}

async function fetchVisualCrossing(loc) {
  if (!VISUALCROSSING_KEY) return null;
  var now = new Date();
  var y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, "0");
  var monthStart = y + "-" + m + "-01";
  var endDate = new Date(now);
  endDate.setDate(endDate.getDate() + 15);
  var endStr = endDate.toISOString().split("T")[0];
  return await sf("https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/" + loc.lat + "," + loc.lon + "/" + monthStart + "/" + endStr + "?key=" + VISUALCROSSING_KEY + "&unitGroup=metric&include=days", "VisualCrossing");
}

async function fetchOpenMeteo(loc) {
  return await sf("https://api.open-meteo.com/v1/forecast?latitude=" + loc.lat + "&longitude=" + loc.lon + "&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=16", "OpenMeteo");
}

/* ───── BUILD HOURLY FROM WEATHERAPI (PRIMARY — MOST RELIABLE) ───── */

function buildHourlyFromWA(waData, timezone) {
  var time = [], temp = [], code = [], isDay = [];
  if (!waData || !waData.forecast || !waData.forecast.forecastday) return { time: time, temperature_2m: temp, weather_code: code, is_day: isDay };

  var days = waData.forecast.forecastday;
  var now = Date.now();

  for (var d = 0; d < days.length; d++) {
    var hours = days[d].hour || [];
    for (var h = 0; h < hours.length; h++) {
      var hr = hours[h];
      var hrTime = hr.time.replace(" ", "T");
      var hrDate = new Date(hrTime);
      if (hrDate.getTime() >= now - 3600000) {
        time.push(hrTime);
        temp.push(hr.temp_c);
        code.push(waCodeToWMO(hr.condition ? hr.condition.code : 1000));
        isDay.push(hr.is_day);
      }
    }
  }

  return { time: time, temperature_2m: temp, weather_code: code, is_day: isDay };
}

/* ───── EXTEND HOURLY WITH PIRATE WEATHER ───── */

function extendHourlyWithPirate(hourly, prData) {
  if (!prData || !prData.hourly || !prData.hourly.data) return hourly;

  var existingTimes = {};
  for (var i = 0; i < hourly.time.length; i++) {
    var t = new Date(hourly.time[i]).getTime();
    existingTimes[Math.round(t / 3600000)] = true;
  }

  var ph = prData.hourly.data;
  var now = Date.now();

  for (var j = 0; j < ph.length && hourly.time.length < 48; j++) {
    var pTime = (ph[j].time || 0) * 1000;
    if (pTime < now - 3600000) continue;

    var hourKey = Math.round(pTime / 3600000);
    if (existingTimes[hourKey]) continue;

    var pDate = new Date(pTime);
    // Format as local ISO string
    var isoStr = pDate.getFullYear() + "-" +
      String(pDate.getMonth() + 1).padStart(2, "0") + "-" +
      String(pDate.getDate()).padStart(2, "0") + "T" +
      String(pDate.getHours()).padStart(2, "0") + ":" +
      String(pDate.getMinutes()).padStart(2, "0") + ":00";

    hourly.time.push(isoStr);
    hourly.temperature_2m.push(ph[j].temperature);
    hourly.weather_code.push(pirateToWMO(ph[j].icon));
    hourly.is_day.push((pDate.getHours() >= 6 && pDate.getHours() < 18) ? 1 : 0);
    existingTimes[hourKey] = true;
  }

  // Sort by time
  var combined = [];
  for (var k = 0; k < hourly.time.length; k++) {
    combined.push({
      time: hourly.time[k],
      temp: hourly.temperature_2m[k],
      code: hourly.weather_code[k],
      isDay: hourly.is_day[k],
      ts: new Date(hourly.time[k]).getTime()
    });
  }
  combined.sort(function (a, b) { return a.ts - b.ts; });

  hourly.time = combined.map(function (c) { return c.time; });
  hourly.temperature_2m = combined.map(function (c) { return c.temp; });
  hourly.weather_code = combined.map(function (c) { return c.code; });
  hourly.is_day = combined.map(function (c) { return c.isDay; });

  return hourly;
}

/* ───── BUILD TIME PERIODS ───── */

function buildTimePeriods(hourly, prData, waData) {
  var periods = [
    { name: "Morning", startH: 6, endH: 12 },
    { name: "Afternoon", startH: 12, endH: 17 },
    { name: "Evening", startH: 17, endH: 21 },
    { name: "Overnight", startH: 21, endH: 30 }
  ];

  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var result = [];

  // Collect all hourly data with precip
  var allHours = [];

  // From WeatherAPI (has precip chance)
  if (waData && waData.forecast && waData.forecast.forecastday) {
    var waDays = waData.forecast.forecastday;
    for (var d = 0; d < waDays.length; d++) {
      var hours = waDays[d].hour || [];
      for (var h = 0; h < hours.length; h++) {
        var hr = hours[h];
        allHours.push({
          time: new Date(hr.time.replace(" ", "T")),
          temp: hr.temp_c,
          code: waCodeToWMO(hr.condition ? hr.condition.code : 1000),
          precip: hr.chance_of_rain || hr.chance_of_snow || 0
        });
      }
    }
  }

  // From Pirate (has precip probability)
  if (prData && prData.hourly && prData.hourly.data) {
    var ph = prData.hourly.data;
    for (var p = 0; p < ph.length; p++) {
      var pTime = new Date((ph[p].time || 0) * 1000);
      allHours.push({
        time: pTime,
        temp: ph[p].temperature,
        code: pirateToWMO(ph[p].icon),
        precip: ph[p].precipProbability != null ? Math.round(ph[p].precipProbability * 100) : null
      });
    }
  }

  // If no hourly data from above, use the built hourly
  if (allHours.length === 0 && hourly && hourly.time) {
    for (var i = 0; i < hourly.time.length; i++) {
      allHours.push({
        time: new Date(hourly.time[i]),
        temp: hourly.temperature_2m[i],
        code: hourly.weather_code[i],
        precip: null
      });
    }
  }

  for (var pi = 0; pi < periods.length; pi++) {
    var per = periods[pi];
    var startTime = new Date(today.getTime() + per.startH * 3600000);
    var endTime = new Date(today.getTime() + (per.endH > 24 ? per.endH : per.endH) * 3600000);

    if (endTime <= now) {
      startTime = new Date(startTime.getTime() + 86400000);
      endTime = new Date(endTime.getTime() + 86400000);
    }

    var temps = [], codes = {}, precips = [];

    for (var ai = 0; ai < allHours.length; ai++) {
      var ah = allHours[ai];
      if (ah.time >= startTime && ah.time < endTime) {
        if (ah.temp != null) temps.push(ah.temp);
        if (ah.code != null) codes[ah.code] = (codes[ah.code] || 0) + 1;
        if (ah.precip != null) precips.push(ah.precip);
      }
    }

    var avgTemp = temps.length ? Math.round(temps.reduce(function (a, b) { return a + b; }, 0) / temps.length) : null;
    var avgPrecip = precips.length ? Math.round(precips.reduce(function (a, b) { return a + b; }, 0) / precips.length) : null;

    var dominantCode = 0, maxCount = 0;
    var codeKeys = Object.keys(codes);
    for (var ci = 0; ci < codeKeys.length; ci++) {
      if (codes[codeKeys[ci]] > maxCount) {
        maxCount = codes[codeKeys[ci]];
        dominantCode = Number(codeKeys[ci]);
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

/* ───── BUILD DAILY (15 DAYS) ───── */

function buildDaily(waData, wbData, msData, vcData, omData) {
  var days = {};
  var now = new Date();
  var todayStr = now.toISOString().split("T")[0];

  console.log("--- Building Daily ---");

  // Step 1: WeatherAPI days 1-3 (conditions + sunrise/sunset + temps as fallback)
  if (waData && waData.forecast && waData.forecast.forecastday) {
    var waDays = waData.forecast.forecastday;
    console.log("WA days:", waDays.length);
    for (var i = 0; i < waDays.length; i++) {
      var d = waDays[i];
      var dd = d.day || {};
      var astro = d.astro || {};
      days[d.date] = {
        date: d.date,
        weather_code: waCodeToWMO(dd.condition ? dd.condition.code : 1000),
        max_temp: dd.maxtemp_c,
        min_temp: dd.mintemp_c,
        precip_chance: first(dd.daily_chance_of_rain, dd.daily_chance_of_snow, 0),
        sunrise: d.date + "T" + c12to24(astro.sunrise),
        sunset: d.date + "T" + c12to24(astro.sunset),
        uv: dd.uv,
        src: "wa"
      };
    }
  }

  // Step 2: Weatherbit days 1-7 (temperatures + UV)
  if (wbData && wbData.data) {
    console.log("WB days:", wbData.data.length);
    // Log first entry to see field names
    if (wbData.data[0]) {
      var sample = wbData.data[0];
      console.log("WB sample keys:", Object.keys(sample).join(","));
      console.log("WB sample temps: max_temp=" + sample.max_temp + " high_temp=" + sample.high_temp + " min_temp=" + sample.min_temp + " low_temp=" + sample.low_temp);
    }

    for (var j = 0; j < wbData.data.length; j++) {
      var wb = wbData.data[j];
      var wbDate = wb.datetime || wb.valid_date;
      if (!wbDate) continue;

      var wbMax = first(wb.high_temp, wb.max_temp, wb.app_max_temp);
      var wbMin = first(wb.low_temp, wb.min_temp, wb.app_min_temp);
      var wbUv = first(wb.uv, wb.max_uv);
      var wbPrecip = first(wb.pop, 0);
      var wbWxCode = wb.weather ? wbCodeToWMO(wb.weather.code) : 0;

      if (days[wbDate]) {
        // Override temps with Weatherbit (your plan: WB for temps)
        if (wbMax != null) days[wbDate].max_temp = wbMax;
        if (wbMin != null) days[wbDate].min_temp = wbMin;
        if (wbUv != null) days[wbDate].uv = wbUv;
      } else {
        // Days 4-7
        days[wbDate] = {
          date: wbDate,
          weather_code: wbWxCode,
          max_temp: wbMax,
          min_temp: wbMin,
          precip_chance: wbPrecip,
          sunrise: null,
          sunset: null,
          uv: wbUv,
          src: "wb"
        };
      }
    }
  }

  // Step 3: Meteosource conditions for days 4-7
  if (msData && msData.daily && msData.daily.data) {
    console.log("MS days:", msData.daily.data.length);
    if (msData.daily.data[0]) {
      console.log("MS sample keys:", Object.keys(msData.daily.data[0]).join(","));
    }

    var msDays = msData.daily.data;
    for (var m = 0; m < msDays.length; m++) {
      var ms = msDays[m];
      var msDate = ms.day;
      if (!msDate) continue;

      var msCode = 0;
      if (ms.icon != null) msCode = msToWMO(ms.icon);
      else if (ms.weather != null) msCode = msToWMO(ms.weather);
      else if (ms.summary) msCode = msToWMO(ms.summary);
      else if (ms.all_day && ms.all_day.weather) msCode = msToWMO(ms.all_day.weather);

      if (days[msDate] && days[msDate].src !== "wa") {
        days[msDate].weather_code = msCode;
      } else if (!days[msDate]) {
        var msMax = null, msMin = null;
        if (ms.all_day) {
          msMax = first(ms.all_day.temperature_max, ms.all_day.temperature);
          msMin = first(ms.all_day.temperature_min);
        }
        if (ms.temperature_max != null) msMax = ms.temperature_max;
        if (ms.temperature_min != null) msMin = ms.temperature_min;

        days[msDate] = {
          date: msDate,
          weather_code: msCode,
          max_temp: msMax,
          min_temp: msMin,
          precip_chance: 0,
          sunrise: null,
          sunset: null,
          uv: null,
          src: "ms"
        };
      }
    }
  }

  // Step 4: Visual Crossing for days 8-15 (conditions + sunrise/sunset + fallback temps)
  if (vcData && vcData.days) {
    console.log("VC days:", vcData.days.length);
    if (vcData.days[0]) {
      console.log("VC sample keys:", Object.keys(vcData.days[0]).join(","));
    }

    for (var v = 0; v < vcData.days.length; v++) {
      var vc = vcData.days[v];
      if (!vc.datetime) continue;

      if (!days[vc.datetime]) {
        days[vc.datetime] = {
          date: vc.datetime,
          weather_code: vcToWMO(first(vc.icon, vc.conditions, "")),
          max_temp: vc.tempmax,
          min_temp: vc.tempmin,
          precip_chance: vc.precipprob || 0,
          sunrise: vc.sunrise ? vc.datetime + "T" + vc.sunrise : null,
          sunset: vc.sunset ? vc.datetime + "T" + vc.sunset : null,
          uv: vc.uvindex,
          src: "vc"
        };
      } else {
        if (!days[vc.datetime].sunrise && vc.sunrise) {
          days[vc.datetime].sunrise = vc.datetime + "T" + vc.sunrise;
        }
        if (!days[vc.datetime].sunset && vc.sunset) {
          days[vc.datetime].sunset = vc.datetime + "T" + vc.sunset;
        }
        if (days[vc.datetime].uv == null && vc.uvindex != null) {
          days[vc.datetime].uv = vc.uvindex;
        }
      }
    }
  }

  // Step 5: Open-Meteo temps for days 8+ (more accurate temps)
  if (omData && omData.daily && omData.daily.time) {
    console.log("OM days:", omData.daily.time.length);
    var omd = omData.daily;
    for (var o = 0; o < omd.time.length; o++) {
      var omDate = omd.time[o];
      if (days[omDate] && days[omDate].src === "vc") {
        if (omd.temperature_2m_max && omd.temperature_2m_max[o] != null) {
          days[omDate].max_temp = omd.temperature_2m_max[o];
        }
        if (omd.temperature_2m_min && omd.temperature_2m_min[o] != null) {
          days[omDate].min_temp = omd.temperature_2m_min[o];
        }
      } else if (!days[omDate]) {
        days[omDate] = {
          date: omDate,
          weather_code: 0,
          max_temp: omd.temperature_2m_max ? omd.temperature_2m_max[o] : null,
          min_temp: omd.temperature_2m_min ? omd.temperature_2m_min[o] : null,
          precip_chance: 0,
          sunrise: null,
          sunset: null,
          uv: null,
          src: "om"
        };
      }
    }
  }

  var sorted = Object.values(days).sort(function (a, b) {
    return new Date(a.date) - new Date(b.date);
  });

  var filtered = sorted.filter(function (d) { return d.date >= todayStr; });
  var final15 = filtered.slice(0, 15);

  console.log("Final daily count:", final15.length);
  for (var f = 0; f < Math.min(3, final15.length); f++) {
    console.log("Day " + f + ":", final15[f].date, "max=" + final15[f].max_temp, "min=" + final15[f].min_temp, "code=" + final15[f].weather_code, "src=" + final15[f].src);
  }

  return final15;
}

/* ───── BUILD MONTHLY ───── */

function buildMonthly(vcData) {
  var monthly = [];
  if (!vcData) {
    console.log("VC data null for monthly");
    return monthly;
  }
  if (!vcData.days) {
    console.log("VC has no days field. Keys:", Object.keys(vcData).join(","));
    return monthly;
  }

  console.log("Building monthly from", vcData.days.length, "VC days");

  for (var i = 0; i < vcData.days.length; i++) {
    var d = vcData.days[i];
    if (!d.datetime) continue;
    monthly.push({
      date: d.datetime,
      weather_code: vcToWMO(first(d.icon, d.conditions, "")),
      max_temp: d.tempmax != null ? d.tempmax : null,
      min_temp: d.tempmin != null ? d.tempmin : null
    });
  }

  return monthly;
}

/* ───── BUILD AIR QUALITY ───── */

function buildAQ(waData, wbData) {
  var values = [];
  if (waData && waData.current && waData.current.air_quality) {
    var pm = waData.current.air_quality.pm2_5;
    if (pm != null && !isNaN(pm)) values.push(pm);
  }
  if (wbData && wbData.data && wbData.data[0]) {
    var aqi = wbData.data[0].aqi;
    if (aqi != null && !isNaN(aqi)) values.push(aqi * 0.3);
  }
  if (!values.length) return null;
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
      return res.json({ results: wa.map(function (i) { return { name: i.name || "", region: i.region || "", country: i.country || "", latitude: i.lat, longitude: i.lon }; }) });
    }

    var om = await sf("https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(q) + "&count=8&language=en&format=json", "OM-Search");
    if (om && om.results) {
      return res.json({ results: om.results.map(function (i) { return { name: i.name || "", region: i.admin1 || "", country: i.country || "", latitude: i.latitude, longitude: i.longitude }; }) });
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
      fetchPirate(loc),
      fetchWeatherbit(loc),
      fetchMeteosource(loc),
      fetchOpenWeather(loc),
      fetchVisualCrossing(loc),
      fetchOpenMeteo(loc)
    ]);

    var waData = results[0];
    var prData = results[1];
    var wbData = results[2];
    var msData = results[3];
    var owData = results[4];
    var vcData = results[5];
    var omData = results[6];

    console.log("API Status — WA:", !!waData, "PR:", !!prData, "WB:", !!wbData, "MS:", !!msData, "OW:", !!owData, "VC:", !!vcData, "OM:", !!omData);

    if (!waData) {
      return res.status(503).json({ error: "Primary weather API unavailable" });
    }

    // Log raw structures for debugging
    if (wbData && wbData.data && wbData.data[0]) {
      var wbSample = wbData.data[0];
      console.log("WB TEMP FIELDS: high_temp=" + wbSample.high_temp + " low_temp=" + wbSample.low_temp + " max_temp=" + wbSample.max_temp + " min_temp=" + wbSample.min_temp);
    }

    if (owData) {
      console.log("OW FIELDS: visibility=" + owData.visibility + " humidity=" + (owData.main ? owData.main.humidity : "N/A"));
    }

    if (vcData) {
      console.log("VC STRUCTURE: has days=" + !!(vcData.days) + " count=" + (vcData.days ? vcData.days.length : 0));
    }

    // Current
    var waCurr = waData.current || {};
    var waLoc = waData.location || {};

    // Build hourly from WeatherAPI (most reliable, correct timezone)
    var hourly = buildHourlyFromWA(waData);
    console.log("WA hourly count:", hourly.time.length);

    // Extend with Pirate Weather for more hours
    hourly = extendHourlyWithPirate(hourly, prData);
    console.log("Extended hourly count:", hourly.time.length);

    // Time periods
    var timePeriods = buildTimePeriods(hourly, prData, waData);

    // Daily 15-day
    var dailyArray = buildDaily(waData, wbData, msData, vcData, omData);

    // Monthly
    var monthly = buildMonthly(vcData);
    console.log("Monthly count:", monthly.length);

    // Air quality
    var pm25 = buildAQ(waData, wbData);

    // Rain chance from Pirate
    var rainChance = null;
    if (prData && prData.currently && prData.currently.precipProbability != null) {
      rainChance = Math.round(prData.currently.precipProbability * 100);
    } else if (prData && prData.daily && prData.daily.data && prData.daily.data[0]) {
      var prDay0 = prData.daily.data[0];
      if (prDay0.precipProbability != null) {
        rainChance = Math.round(prDay0.precipProbability * 100);
      }
    }
    // Fallback to WeatherAPI
    if (rainChance == null && waData.forecast && waData.forecast.forecastday && waData.forecast.forecastday[0]) {
      var waDay0 = waData.forecast.forecastday[0].day;
      if (waDay0) rainChance = first(waDay0.daily_chance_of_rain, waDay0.daily_chance_of_snow, 0);
    }

    // Visibility from OpenWeather
    var visibility = null;
    if (owData && owData.visibility != null) {
      visibility = owData.visibility; // in meters
    }
    // Fallback to WeatherAPI
    if (visibility == null && waCurr.vis_km != null) {
      visibility = waCurr.vis_km * 1000;
    }

    // Humidity from OpenWeather
    var humidity = null;
    if (owData && owData.main && owData.main.humidity != null) {
      humidity = owData.main.humidity;
    }
    if (humidity == null) humidity = waCurr.humidity;

    // Wind from WeatherAPI (Tomorrow.io removed to reduce calls)
    var windKph = waCurr.wind_kph;

    // RealFeel from WeatherAPI
    var feelsLike = waCurr.feelslike_c;

    // UV from Weatherbit
    var uv = null;
    if (wbData && wbData.data && wbData.data[0]) {
      uv = first(wbData.data[0].uv, wbData.data[0].max_uv);
    }
    if (uv == null) uv = waCurr.uv;

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
        feelslike_c: feelsLike,
        humidity: humidity,
        wind_kph: windKph,
        wind_degree: first(waCurr.wind_degree),
        pressure_hpa: first(waCurr.pressure_mb),
        visibility: visibility,
        rain_chance: rainChance,
        uv: uv,
        air_quality_pm25: pm25
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

    if (!result.location.name || result.location.name === "Unknown" || result.location.name === "") {
      if (waLoc.name) {
        result.location.name = waLoc.name;
        result.location.region = waLoc.region || "";
        result.location.country = waLoc.country || "";
      }
    }

    putC(cKey, result);

    console.log("=== Done. Hourly:", hourly.time.length, "Daily:", dTime.length, "Monthly:", monthly.length, "===\n");

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