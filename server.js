require("dotenv").config();

const express = require("express");
const cors = require("cors");
const app = express();
app.use(cors());

const WEATHERAPI_KEY = process.env.WEATHERAPI_KEY;
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
  if (Date.now() - e.time > CACHE_DURATION) {
    delete cache[key];
    return null;
  }
  return e.data;
}

function putC(key, data) {
  var keys = Object.keys(cache);
  if (keys.length > 300) {
    var sorted = keys.sort(function (a, b) {
      return (cache[a].time || 0) - (cache[b].time || 0);
    });
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

/* ───── CODE CONVERTERS ───── */

function waCodeToWMO(c) {
  var m = { 1000: 0, 1003: 2, 1006: 3, 1009: 3, 1030: 45, 1063: 61, 1066: 71, 1069: 66, 1072: 56, 1087: 95, 1114: 73, 1117: 75, 1135: 45, 1147: 48, 1150: 51, 1153: 51, 1168: 56, 1171: 57, 1180: 61, 1183: 61, 1186: 63, 1189: 63, 1192: 65, 1195: 65, 1198: 66, 1201: 67, 1204: 66, 1207: 67, 1210: 71, 1213: 71, 1216: 73, 1219: 73, 1222: 75, 1225: 75, 1237: 77, 1240: 80, 1243: 81, 1246: 82, 1249: 85, 1252: 86, 1255: 85, 1258: 86, 1261: 77, 1264: 77, 1273: 95, 1276: 95, 1279: 95, 1282: 96 };
  return m[c] !== undefined ? m[c] : 0;
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

/* ───── BUILD HOURLY FROM WEATHERAPI ───── */

function buildHourlyFromWA(waData, tz) {
  var time = [], temp = [], code = [], isDay = [];
  if (!waData || !waData.forecast || !waData.forecast.forecastday) {
    return { time: time, temperature_2m: temp, weather_code: code, is_day: isDay };
  }

  var days = waData.forecast.forecastday;
  var nowEpoch = Math.floor(Date.now() / 1000);

  for (var d = 0; d < days.length; d++) {
    var hours = days[d].hour || [];
    for (var h = 0; h < hours.length; h++) {
      var hr = hours[h];
      if (hr.time_epoch && hr.time_epoch >= nowEpoch - 3600) {
        var localTimeStr = hr.time.replace(" ", "T");
        time.push(localTimeStr);
        temp.push(hr.temp_c);
        code.push(waCodeToWMO(hr.condition ? hr.condition.code : 1000));
        isDay.push(hr.is_day);
      }
    }
  }

  console.log("WA hourly: " + time.length + " hours, first=" + (time[0] || "none"));
  return { time: time, temperature_2m: temp, weather_code: code, is_day: isDay };
}

/* ───── EXTEND HOURLY WITH PIRATE WEATHER ───── */

function extendHourlyWithPirate(hourly, prData, tz) {
  if (!prData || !prData.hourly || !prData.hourly.data) return hourly;

  var existingKeys = {};
  for (var i = 0; i < hourly.time.length; i++) {
    existingKeys[hourly.time[i].substring(0, 13)] = true;
  }

  var ph = prData.hourly.data;
  var nowEpoch = Math.floor(Date.now() / 1000);

  for (var j = 0; j < ph.length && hourly.time.length < 48; j++) {
    var pEpoch = ph[j].time || 0;
    if (pEpoch < nowEpoch - 3600) continue;

    var localStr = epochToLocalISO(pEpoch, tz);
    var hourKey = localStr.substring(0, 13);
    if (existingKeys[hourKey]) continue;

    var localHour = parseInt(localStr.substring(11, 13));

    hourly.time.push(localStr);
    hourly.temperature_2m.push(ph[j].temperature);
    hourly.weather_code.push(pirateToWMO(ph[j].icon));
    hourly.is_day.push((localHour >= 6 && localHour < 18) ? 1 : 0);
    existingKeys[hourKey] = true;
  }

  var combined = [];
  for (var k = 0; k < hourly.time.length; k++) {
    combined.push({
      time: hourly.time[k],
      temp: hourly.temperature_2m[k],
      code: hourly.weather_code[k],
      isDay: hourly.is_day[k]
    });
  }
  combined.sort(function (a, b) { return a.time.localeCompare(b.time); });

  hourly.time = combined.map(function (c) { return c.time; });
  hourly.temperature_2m = combined.map(function (c) { return c.temp; });
  hourly.weather_code = combined.map(function (c) { return c.code; });
  hourly.is_day = combined.map(function (c) { return c.isDay; });

  return hourly;
}

/* ───── BUILD TIME PERIODS ───── */

function buildTimePeriods(waData, prData, tz) {
  var periods = [
    { name: "Morning", startH: 6, endH: 12 },
    { name: "Afternoon", startH: 12, endH: 17 },
    { name: "Evening", startH: 17, endH: 21 },
    { name: "Overnight", startH: 21, endH: 30 }
  ];

  var allHours = [];
  if (waData && waData.forecast && waData.forecast.forecastday) {
    var waDays = waData.forecast.forecastday;
    for (var d = 0; d < waDays.length; d++) {
      var hours = waDays[d].hour || [];
      for (var h = 0; h < hours.length; h++) {
        var hr = hours[h];
        allHours.push({
          epoch: hr.time_epoch,
          localHour: getLocalHour(hr.time_epoch, tz),
          localDate: epochToLocalISO(hr.time_epoch, tz).substring(0, 10),
          temp: hr.temp_c,
          code: waCodeToWMO(hr.condition ? hr.condition.code : 1000),
          precip: hr.chance_of_rain || hr.chance_of_snow || 0
        });
      }
    }
  }

  if (prData && prData.hourly && prData.hourly.data) {
    var ph = prData.hourly.data;
    for (var p = 0; p < ph.length; p++) {
      var pEpoch = ph[p].time || 0;
      var exists = false;
      for (var e = 0; e < allHours.length; e++) {
        if (Math.abs(allHours[e].epoch - pEpoch) < 1800) { exists = true; break; }
      }
      if (!exists) {
        allHours.push({
          epoch: pEpoch,
          localHour: getLocalHour(pEpoch, tz),
          localDate: epochToLocalISO(pEpoch, tz).substring(0, 10),
          temp: ph[p].temperature,
          code: pirateToWMO(ph[p].icon),
          precip: ph[p].precipProbability != null ? Math.round(ph[p].precipProbability * 100) : null
        });
      }
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
      if (codes[keys[ci]] > maxCount) { maxCount = codes[keys[ci]]; dominantCode = Number(keys[ci]); }
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
/*
  Days 1-3:  Conditions -> WeatherAPI, Temps -> Open-Meteo
  Days 4-7:  Conditions -> Meteosource, Temps -> Open-Meteo
  Days 8-15: Conditions -> Visual Crossing, Temps -> Open-Meteo
  Fallback temp source if OM missing: Weatherbit (days 1-7), VC (days 8-15)
*/

function buildDaily(waData, wbData, msData, vcData, omData) {
  var days = {};
  var now = new Date();
  var todayStr = now.toISOString().split("T")[0];

  console.log("--- Building Daily ---");

  // Step 1: WeatherAPI days 1-3 conditions + sunrise/sunset
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

  // Step 2: Meteosource conditions for days 4-7
  if (msData && msData.daily && msData.daily.data) {
    var msDays = msData.daily.data;
    console.log("MS days:", msDays.length);
    for (var m = 0; m < msDays.length; m++) {
      var ms = msDays[m];
      var msDate = ms.day;
      if (!msDate) continue;

      var msCode = 0;
      if (ms.icon != null) msCode = msToWMO(ms.icon);
      else if (ms.weather != null) msCode = msToWMO(ms.weather);
      else if (ms.summary) msCode = msToWMO(ms.summary);
      else if (ms.all_day && ms.all_day.weather) msCode = msToWMO(ms.all_day.weather);

      if (!days[msDate]) {
        days[msDate] = {
          date: msDate,
          weather_code: msCode,
          max_temp: null,
          min_temp: null,
          precip_chance: 0,
          sunrise: null,
          sunset: null,
          uv: null,
          src: "ms"
        };
      } else if (days[msDate].src !== "wa") {
        days[msDate].weather_code = msCode;
        days[msDate].src = "ms";
      }
    }
  }

  // Step 3: Visual Crossing conditions for days 8-15
  if (vcData && vcData.days) {
    console.log("VC days:", vcData.days.length);
    for (var v = 0; v < vcData.days.length; v++) {
      var vc = vcData.days[v];
      if (!vc.datetime) continue;

      if (!days[vc.datetime]) {
        days[vc.datetime] = {
          date: vc.datetime,
          weather_code: vcToWMO(first(vc.icon, vc.conditions, "")),
          max_temp: vc.tempmax, // fallback only
          min_temp: vc.tempmin, // fallback only
          precip_chance: vc.precipprob || 0,
          sunrise: vc.sunrise ? vc.datetime + "T" + vc.sunrise : null,
          sunset: vc.sunset ? vc.datetime + "T" + vc.sunset : null,
          uv: vc.uvindex,
          src: "vc"
        };
      } else {
        if (!days[vc.datetime].sunrise && vc.sunrise) days[vc.datetime].sunrise = vc.datetime + "T" + vc.sunrise;
        if (!days[vc.datetime].sunset && vc.sunset) days[vc.datetime].sunset = vc.datetime + "T" + vc.sunset;
        if (days[vc.datetime].uv == null && vc.uvindex != null) days[vc.datetime].uv = vc.uvindex;
      }
    }
  }

  // Step 4: Open-Meteo temperatures for ALL 15 days (primary temp source)
  if (omData && omData.daily && omData.daily.time) {
    console.log("OM days:", omData.daily.time.length);
    var omd = omData.daily;
    for (var o = 0; o < omd.time.length && o < 15; o++) {
      var omDate = omd.time[o];
      var omMax = omd.temperature_2m_max ? omd.temperature_2m_max[o] : null;
      var omMin = omd.temperature_2m_min ? omd.temperature_2m_min[o] : null;

      if (days[omDate]) {
        if (omMax != null) days[omDate].max_temp = omMax;
        if (omMin != null) days[omDate].min_temp = omMin;
      } else {
        days[omDate] = {
          date: omDate,
          weather_code: 0,
          max_temp: omMax,
          min_temp: omMin,
          precip_chance: 0,
          sunrise: null,
          sunset: null,
          uv: null,
          src: "om"
        };
      }
    }
  } else {
    console.log("Open-Meteo unavailable, using fallbacks for temps");
  }

  // Step 5: Weatherbit fallback temperatures for days 1-7 only if OM missing
  if ((!omData || !omData.daily) && wbData && wbData.data) {
    console.log("Using Weatherbit fallback temps");
    for (var j = 0; j < wbData.data.length; j++) {
      var wb = wbData.data[j];
      var wbDate = wb.datetime || wb.valid_date;
      if (!wbDate) continue;

      var wbMax = first(wb.high_temp, wb.max_temp, wb.app_max_temp);
      var wbMin = first(wb.low_temp, wb.min_temp, wb.app_min_temp);
      var wbUv = first(wb.uv, wb.max_uv);

      if (days[wbDate]) {
        if (days[wbDate].max_temp == null && wbMax != null) days[wbDate].max_temp = wbMax;
        if (days[wbDate].min_temp == null && wbMin != null) days[wbDate].min_temp = wbMin;
        if (days[wbDate].uv == null && wbUv != null) days[wbDate].uv = wbUv;
      }
    }
  }

  // Step 6: Visual Crossing fallback temperatures for days 8-15 only if OM missing
  if ((!omData || !omData.daily) && vcData && vcData.days) {
    console.log("Using VC fallback temps for days 8-15");
    for (var vv = 0; vv < vcData.days.length; vv++) {
      var vcd = vcData.days[vv];
      if (!vcd.datetime) continue;
      if (days[vcd.datetime]) {
        if (days[vcd.datetime].max_temp == null && vcd.tempmax != null) days[vcd.datetime].max_temp = vcd.tempmax;
        if (days[vcd.datetime].min_temp == null && vcd.tempmin != null) days[vcd.datetime].min_temp = vcd.tempmin;
      }
    }
  }

  // Step 7: Weatherbit UV fill
  if (wbData && wbData.data) {
    for (var u = 0; u < wbData.data.length; u++) {
      var wbu = wbData.data[u];
      var wbuDate = wbu.datetime || wbu.valid_date;
      if (wbuDate && days[wbuDate] && days[wbuDate].uv == null) {
        days[wbuDate].uv = first(wbu.uv, wbu.max_uv);
      }
    }
  }

  var sorted = Object.values(days).sort(function (a, b) {
    return new Date(a.date) - new Date(b.date);
  });

  var filtered = sorted.filter(function (d) { return d.date >= todayStr; });
  var final15 = filtered.slice(0, 15);

  console.log("Final daily count:", final15.length);
  for (var f = 0; f < final15.length; f++) {
    console.log("Day " + f + ": " + final15[f].date + " max=" + final15[f].max_temp + " min=" + final15[f].min_temp + " code=" + final15[f].weather_code + " src=" + final15[f].src);
  }

  return final15;
}

/* ───── BUILD MONTHLY ───── */

function buildMonthly(vcData) {
  var monthly = [];
  if (!vcData || !vcData.days) {
    console.log("VC missing for monthly");
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
      fetchOpenMeteo(loc).catch(function () { return null; })
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

    var waCurr = waData.current || {};
    var waLoc = waData.location || {};
    var tz = waLoc.tz_id || (omData ? omData.timezone : null) || "UTC";
    console.log("Timezone:", tz);

    var hourly = buildHourlyFromWA(waData, tz);
    hourly = extendHourlyWithPirate(hourly, prData, tz);
    console.log("Total hourly:", hourly.time.length);

    var timePeriods = buildTimePeriods(waData, prData, tz);
    var dailyArray = buildDaily(waData, wbData, msData, vcData, omData);
    var monthly = buildMonthly(vcData);
    var pm25 = buildAQ(waData, wbData);

    var rainChance = null;
    if (prData && prData.currently && prData.currently.precipProbability != null) {
      rainChance = Math.round(prData.currently.precipProbability * 100);
    }
    if (rainChance == null && prData && prData.daily && prData.daily.data && prData.daily.data[0]) {
      if (prData.daily.data[0].precipProbability != null) {
        rainChance = Math.round(prData.daily.data[0].precipProbability * 100);
      }
    }
    if (rainChance == null && waData.forecast && waData.forecast.forecastday && waData.forecast.forecastday[0]) {
      var waDay0 = waData.forecast.forecastday[0].day;
      if (waDay0) rainChance = first(waDay0.daily_chance_of_rain, waDay0.daily_chance_of_snow, 0);
    }

    var visibility = null;
    if (owData && owData.visibility != null) visibility = owData.visibility;
    if (visibility == null && waCurr.vis_km != null) visibility = waCurr.vis_km * 1000;

    var humidity = null;
    if (owData && owData.main && owData.main.humidity != null) humidity = owData.main.humidity;
    if (humidity == null) humidity = waCurr.humidity;

    var uv = null;
    if (wbData && wbData.data && wbData.data[0]) uv = first(wbData.data[0].uv, wbData.data[0].max_uv);
    if (uv == null) uv = waCurr.uv;

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
        temperature_c: first(waCurr.temp_c),
        weather_code: waCodeToWMO(waCurr.condition ? waCurr.condition.code : 1000),
        condition_text: waCurr.condition ? waCurr.condition.text : null,
        is_day: first(waCurr.is_day, 1),
        feelslike_c: first(waCurr.feelslike_c),
        humidity: humidity,
        wind_kph: first(waCurr.wind_kph),
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