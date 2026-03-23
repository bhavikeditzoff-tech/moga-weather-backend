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
const GEMINI_KEY = process.env.GEMINI_API_KEY;

/* ───── CACHE ───── */

var generalCache = {};
var accuLocationCache = {};
var accuForecastCache = {};
var recommendationsCache = {};

var GENERAL_CACHE_MS = 10 * 60 * 1000;
var ACCU_LOCATION_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
var ACCU_FORECAST_CACHE_MS = 6 * 60 * 60 * 1000;
var RECOMMENDATIONS_CACHE_MS = 60 * 60 * 1000; // 1 hour

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
  var out = { cloudCover: null, cloudCeiling: null };
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
  var out = { precipitation_probability: null, cape: null };
  if (!omStorm || !omStorm.hourly || !omStorm.hourly.time || !omStorm.hourly.time.length) return out;

  var idx = 0;
  var best = Infinity;
  var now = Date.now();

  for (var i = 0; i < omStorm.hourly.time.length; i++) {
    var t = new Date(omStorm.hourly.time[i]).getTime();
    var d = Math.abs(now - t);
    if (d < best) { best = d; idx = i; }
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

  // No storm possible if precip < 30% regardless of CAPE
  if (p < 30) return 0;

  var stormProbability = (p * 0.6) + (c * 0.1) + (capeFactor * 0.3);
  stormProbability = Math.min(100, stormProbability);
  return roundVal(stormProbability);
}

/* ───── HOURLY ───── */

function buildHourlyFromOpenMeteo(omHourlyData, currentTemp, currentWeatherCode, tz) {
  var out = { time: [], temperature_2m: [], weather_code: [], is_day: [] };

  if (!omHourlyData || !omHourlyData.hourly || !omHourlyData.hourly.time || !omHourlyData.hourly.time.length) {
    return out;
  }

  var h = omHourlyData.hourly;
  var now = new Date();
  var parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23"
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
    if (String(h.time[i]).substring(0, 13) === currentHourKey) { startIdx = i; break; }
  }
  if (startIdx === -1) {
    for (var j = 0; j < h.time.length; j++) {
      if (String(h.time[j]).substring(0, 13) >= currentHourKey) { startIdx = j; break; }
    }
  }
  if (startIdx === -1) startIdx = 0;

  for (var k = startIdx; k < h.time.length && out.time.length < 24; k++) {
    out.time.push(h.time[k]);
    out.temperature_2m.push(h.temperature_2m ? roundVal(h.temperature_2m[k]) : null);
    out.weather_code.push(h.weather_code ? h.weather_code[k] : 0);
    out.is_day.push(h.is_day ? h.is_day[k] : 1);
  }

  if (out.temperature_2m.length && currentTemp != null) out.temperature_2m[0] = roundVal(currentTemp);
  if (out.weather_code.length && currentWeatherCode != null) out.weather_code[0] = currentWeatherCode;

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
          if (d.AirAndPollen[p].Name === "UVIndex") { uvVal = d.AirAndPollen[p].Value; break; }
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
    var maxCandidates = [], minCandidates = [], condCandidates = [], precipCandidates = [];
    var date = null, sunrise = null, sunset = null, uv = null;

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

/* ───── MONTHLY (Open-Meteo Archive) ───── */

function buildMonthly(omMonthlyData, dailyArray) {
  var map = {};

  if (omMonthlyData && omMonthlyData.daily && omMonthlyData.daily.time) {
    var d = omMonthlyData.daily;
    for (var i = 0; i < d.time.length; i++) {
      map[d.time[i]] = {
        date: d.time[i],
        weather_code: d.weather_code ? d.weather_code[i] : 0,
        max_temp: d.temperature_2m_max ? d.temperature_2m_max[i] : null,
        min_temp: d.temperature_2m_min ? d.temperature_2m_min[i] : null,
        available: true
      };
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

/* ───── RECOMMENDATIONS (Gemini AI) ───── */

async function buildRecommendations(payload) {
  // Cache key: location + condition + temp (changes meaningfully per hour at most)
  var cacheKey = (payload.locationName || "") + "|" + (payload.conditionText || "") + "|" + (payload.currentTemp || "");
  var cached = getCached(recommendationsCache, cacheKey, RECOMMENDATIONS_CACHE_MS);
  if (cached) {
    console.log("Recommendations cache hit:", cacheKey);
    return cached;
  }

  try {
    var prompt =
      "You are a friendly, conversational weather assistant. Based on the weather data below, " +
      "write 6 to 8 short, natural-sounding recommendations for someone planning their day. " +
      "Each recommendation should be a single sentence. Be specific, warm, and practical — " +
      "like a knowledgeable friend giving advice, not a weather report. " +
      "Vary the tone: some can be casual, some cautionary, some encouraging. " +
      "Return ONLY a JSON array of strings, no preamble, no markdown, no extra text.\n\n" +
      "Weather data:\n" +
      "- Location: " + (payload.locationName || "Unknown") + "\n" +
      "- Temperature: " + (payload.currentTemp != null ? payload.currentTemp + "°C" : "Unknown") + "\n" +
      "- Feels like: " + (payload.realFeel != null ? payload.realFeel + "°C" : "Unknown") + "\n" +
      "- Condition: " + (payload.conditionText || "Unknown") + "\n" +
      "- Humidity: " + (payload.humidity != null ? payload.humidity + "%" : "Unknown") + "\n" +
      "- Wind speed: " + (payload.wind != null ? payload.wind + " km/h" : "Unknown") + "\n" +
      "- Rain chance: " + (payload.rainChance != null ? payload.rainChance + "%" : "Unknown") + "\n" +
      "- UV index: " + (payload.uv != null ? payload.uv : "Unknown") + "\n" +
      "- Air quality (AQI): " + (payload.aqi != null ? payload.aqi : "Unknown") + "\n" +
      "- Visibility: " + (payload.visibilityKm != null ? payload.visibilityKm.toFixed(1) + " km" : "Unknown") + "\n" +
      "- Cloud cover: " + (payload.cloudCover != null ? payload.cloudCover + "%" : "Unknown") + "\n" +
      "- Thunderstorm probability: " + (payload.thunderProbability != null ? payload.thunderProbability + "%" : "Unknown") + "\n" +
      "- Dew point: " + (payload.dewPoint != null ? payload.dewPoint + "°C" : "Unknown") + "\n" +
      "- Sunset: " + (payload.sunsetText || "Unknown") + "\n";

    var response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" + GEMINI_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 1024 }
        })
      }
    );

    if (!response.ok) {
      var errText = await response.text();
      console.log("Gemini error body:", errText);
      throw new Error("Gemini HTTP " + response.status);
    }

    var data = await response.json();
    var text =
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0]
        ? data.candidates[0].content.parts[0].text
        : "";

    // Strip markdown fences if present
    text = text.replace(/```json|```/g, "").trim();

    var parsed = JSON.parse(text);

    // Flatten if Gemini wraps in extra array
    if (Array.isArray(parsed) && Array.isArray(parsed[0])) parsed = parsed[0];

    // Extract strings if Gemini returns objects
    parsed = parsed.map(function (r) {
      return typeof r === "string" ? r : (r.text || r.recommendation || r.message || JSON.stringify(r));
    });

    if (parsed.length) {
      var result = parsed.slice(0, 8);
      setCached(recommendationsCache, cacheKey, result);
      console.log("Gemini recommendations OK:", result.length, "recs for", payload.locationName);
      return result;
    }
  } catch (e) {
    console.log("Gemini recommendations ERR:", e.message);
  }

  // Fallback to deterministic if Gemini fails
  return buildRecommendationsFallback(payload);
}

function buildRecommendationsFallback(payload) {
  var recs = [];
  var temp = payload.currentTemp;
  var rain = payload.rainChance;
  var uv = payload.uv;
  var aqi = payload.aqi;
  var wind = payload.wind;
  var thunder = payload.thunderProbability;
  var humidity = payload.humidity;
  var visibility = payload.visibilityKm;

  if (temp != null) {
    if (temp >= 35) recs.push("It's extremely hot outside — avoid long exposure and stay hydrated.");
    else if (temp >= 30) recs.push("A warm day ahead — light clothing and water will help.");
    else if (temp <= 12) recs.push("It's fairly cool — a light jacket may feel comfortable.");
    else recs.push("The temperature feels comfortable for most outdoor activity.");
  }
  if (rain != null && rain >= 70) recs.push("Rain is likely — carrying an umbrella is a good idea.");
  else if (rain != null && rain >= 40) recs.push("There's a fair chance of rain, so keep backup plans ready.");
  if (uv != null && uv >= 8) recs.push("UV is very strong — sunscreen and shade are strongly recommended.");
  else if (uv != null && uv >= 5) recs.push("UV is moderate — consider sunscreen for extended outdoor time.");
  if (aqi != null && aqi > 150) recs.push("Air quality is poor — reduce long outdoor exposure if possible.");
  else if (aqi != null && aqi > 80) recs.push("Air quality is moderate — sensitive individuals should be cautious.");
  if (wind != null && wind >= 30) recs.push("It's fairly windy — secure light items and expect breezy conditions.");
  if (humidity != null && humidity >= 80) recs.push("Humidity is high — it may feel sticky outdoors.");
  if (visibility != null && visibility <= 2) recs.push("Visibility is poor — drive carefully.");
  if (thunder != null && thunder >= 60) recs.push("Thunderstorm potential is high — avoid exposed outdoor areas.");
  if (!recs.length) recs.push("Weather looks fairly stable right now — enjoy your day!");
  return recs;
}

/* ───── LOCATION RESOLUTION ───── */

async function resolveIp() {
  try {
    var r = await sf("https://ipapi.co/json/", "IP-resolve");
    if (r && r.latitude && r.longitude) {
      return {
        lat: r.latitude,
        lon: r.longitude,
        name: r.city || "Unknown",
        region: r.region || "",
        country: r.country_name || "",
        key: null
      };
    }
  } catch (e) {
    console.log("resolveIp ERR:", e.message);
  }
  return { lat: 51.5074, lon: -0.1278, name: "London", region: "England", country: "United Kingdom", key: null };
}

async function resolveLoc(query) {
  if (query.lat != null && query.lon != null) {
    var lat = parseFloat(query.lat);
    var lon = parseFloat(query.lon);
    try {
      var r = await sf(
        "https://api.weatherapi.com/v1/search.json?key=" + WEATHERAPI_KEY + "&q=" + lat + "," + lon,
        "ResolveLoc-coords"
      );
      if (r && r.length) {
        return { lat: lat, lon: lon, name: r[0].name || "", region: r[0].region || "", country: r[0].country || "", key: null };
      }
    } catch (e) {}
    return { lat: lat, lon: lon, name: "", region: "", country: "", key: null };
  }

  if (query.city) {
    try {
      var results = await sf(
        "https://api.weatherapi.com/v1/search.json?key=" + WEATHERAPI_KEY + "&q=" + encodeURIComponent(query.city),
        "ResolveLoc-city"
      );
      if (results && results.length) {
        return {
          lat: results[0].lat, lon: results[0].lon,
          name: results[0].name || query.city,
          region: results[0].region || "",
          country: results[0].country || "",
          key: null
        };
      }
    } catch (e) {}
    return { lat: 51.5074, lon: -0.1278, name: query.city, region: "", country: "", key: null };
  }

  return resolveIp();
}

/* ───── DATA SOURCE FETCHERS ───── */

function fetchWeatherApi(loc) {
  return sf(
    "https://api.weatherapi.com/v1/forecast.json?key=" + WEATHERAPI_KEY +
    "&q=" + loc.lat + "," + loc.lon + "&days=3&aqi=yes",
    "WeatherAPI"
  );
}

function fetchTomorrowCurrent(loc) {
  return sf(
    "https://api.tomorrow.io/v4/timelines?location=" + loc.lat + "," + loc.lon +
    "&fields=temperature,temperatureApparent,cloudCover,dewPoint,treeIndex,grassIndex,weedIndex" +
    "&timesteps=current&units=metric&apikey=" + TOMORROW_KEY,
    "Tomorrow"
  );
}

function fetchWeatherbitCurrent(loc) {
  return sf(
    "https://api.weatherbit.io/v2.0/current?lat=" + loc.lat + "&lon=" + loc.lon +
    "&key=" + WEATHERBIT_KEY + "&units=M",
    "WeatherbitCurrent"
  );
}

function fetchWeatherbitDaily(loc) {
  return sf(
    "https://api.weatherbit.io/v2.0/forecast/daily?lat=" + loc.lat + "&lon=" + loc.lon +
    "&key=" + WEATHERBIT_KEY + "&units=M&days=7",
    "WeatherbitDaily"
  );
}

function fetchPirate(loc) {
  return sf(
    "https://api.pirateweather.net/forecast/" + PIRATE_KEY +
    "/" + loc.lat + "," + loc.lon + "?units=si",
    "Pirate"
  );
}

function fetchOpenWeather(loc) {
  return sf(
    "https://api.openweathermap.org/data/2.5/weather?lat=" + loc.lat + "&lon=" + loc.lon +
    "&appid=" + OPENWEATHER_KEY + "&units=metric",
    "OpenWeather"
  );
}

function fetchOpenMeteoCurrent(loc) {
  return sf(
    "https://api.open-meteo.com/v1/forecast?latitude=" + loc.lat + "&longitude=" + loc.lon +
    "&current=temperature_2m,apparent_temperature,weather_code,is_day&timezone=auto",
    "OMCurrent"
  );
}

function fetchOpenMeteoHourly(loc) {
  return sf(
    "https://api.open-meteo.com/v1/forecast?latitude=" + loc.lat + "&longitude=" + loc.lon +
    "&hourly=temperature_2m,weather_code,is_day&forecast_days=2&timezone=auto",
    "OMHourly"
  );
}

function fetchOpenMeteoDaily7(loc) {
  return sf(
    "https://api.open-meteo.com/v1/forecast?latitude=" + loc.lat + "&longitude=" + loc.lon +
    "&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,sunrise,sunset,uv_index_max" +
    "&forecast_days=7&timezone=auto",
    "OMDaily7"
  );
}

function fetchOpenMeteoStorm(loc) {
  return sf(
    "https://api.open-meteo.com/v1/forecast?latitude=" + loc.lat + "&longitude=" + loc.lon +
    "&hourly=precipitation_probability,cape&forecast_days=1&timezone=auto",
    "OMStorm"
  );
}

async function fetchAccuForecast(loc) {
  try {
    var locKey = makeCK(loc.lat, loc.lon);
    var cachedKey = getCached(accuLocationCache, locKey, ACCU_LOCATION_CACHE_MS);

    if (!cachedKey) {
      var locData = await sf(
        "http://dataservice.accuweather.com/locations/v1/cities/geoposition/search?apikey=" + ACCUWEATHER_API_KEY +
        "&q=" + loc.lat + "," + loc.lon,
        "AccuLocation"
      );
      if (locData && locData.Key) {
        cachedKey = locData.Key;
        setCached(accuLocationCache, locKey, cachedKey);
      }
    }

    if (!cachedKey) return null;

    var cachedForecast = getCached(accuForecastCache, cachedKey, ACCU_FORECAST_CACHE_MS);
    if (cachedForecast) return cachedForecast;

    var forecast = await sf(
      "http://dataservice.accuweather.com/forecasts/v1/daily/5day/" + cachedKey +
      "?apikey=" + ACCUWEATHER_API_KEY + "&details=true&metric=true",
      "AccuForecast"
    );

    if (forecast) setCached(accuForecastCache, cachedKey, forecast);
    return forecast;
  } catch (e) {
    console.log("AccuWeather ERR:", e.message);
    return null;
  }
}

function fetchVisualCrossingMonthly(loc) {
  var today = new Date();
  var firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split("T")[0];
  var todayStr = today.toISOString().split("T")[0];

  return sf(
    "https://archive-api.open-meteo.com/v1/archive?latitude=" + loc.lat +
    "&longitude=" + loc.lon +
    "&start_date=" + firstOfMonth +
    "&end_date=" + todayStr +
    "&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto",
    "OMMonthly"
  );
}

function fetchVisualCrossing7(loc) {
  return sf(
    "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/" +
    loc.lat + "," + loc.lon +
    "?key=" + VISUAL_CROSSING_KEY + "&unitGroup=metric&include=days" +
    "&elements=datetime,tempmax,tempmin,icon,conditions,precipprob,sunrise,sunset,uvindex&forecast_days=7",
    "VC7"
  );
}

function fetchMeteoblueCurrent(loc) {
  return sf(
    "https://my.meteoblue.com/packages/basic-1h?apikey=" + METEOBLUE_API_KEY +
    "&lat=" + loc.lat + "&lon=" + loc.lon + "&asl=50&format=json",
    "Meteoblue"
  );
}

function fetchCheckWX(loc) {
  return fetch(
    "https://api.checkwx.com/metar/lat/" + loc.lat + "/lon/" + loc.lon + "/decoded",
    { headers: { "X-API-Key": CHECKWX_API_KEY } }
  )
    .then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          console.log("CheckWX HTTP " + r.status + ": " + t.substring(0, 300));
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

function buildAQ(waData, wbDaily) {
  try {
    if (waData && waData.current && waData.current.air_quality) {
      var aq = waData.current.air_quality;
      if (aq.pm2_5 != null) return aq.pm2_5;
    }
    if (wbDaily && wbDaily.data && wbDaily.data[0] && wbDaily.data[0].aqi != null) {
      return wbDaily.data[0].aqi;
    }
  } catch (e) {}
  return null;
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
    var conditionText = getWeatherText(weatherCode, currentIsDay);

    var hourly = buildHourlyFromOpenMeteo(omHourlyData, currentTemp, weatherCode, tz);
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
    if (rainChance == null && dailyArray.length) rainChance = dailyArray[0].precip_chance;

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

    var recommendations = await buildRecommendations({
      locationName: loc.name,
      conditionText: conditionText,
      dewPoint: skyMetrics.dew_point,
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

app.get("/api/search", async function (req, res) {
  try {
    var q = (req.query.q || "").trim();
    if (!q) return res.json({ results: [] });

    var wa = await sf(
      "https://api.weatherapi.com/v1/search.json?key=" + WEATHERAPI_KEY + "&q=" + encodeURIComponent(q),
      "Search"
    );
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

app.get("/", function (req, res) {
  res.send("RealWeather backend running");
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
  console.log("Server on http://localhost:" + PORT);
});