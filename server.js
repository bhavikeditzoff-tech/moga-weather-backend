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
    var tmHourlyData = results[2];
    var wbCurrent = results[3];
    var wbDaily = results[4];
    var prData = results[5];
    var owData = results[6];
    var omCurrentData = results[7];
    var omHourlyData = results[8];
    var omDaily7 = results[9];
    var omStormData = results[10];
    var accuData = results[11];
    var vcMonthlyData = results[12];
    var vc7 = results[13];
    var meteoblueData = results[14];
    var checkwxData = results[15];

    console.log(
      "API Status — WA:", !!waData,
      "TM:", !!tmCurrentData,
      "TMH:", !!tmHourlyData,
      "WBC:", !!wbCurrent,
      "WBD:", !!wbDaily,
      "PR:", !!prData,
      "OW:", !!owData,
      "OMC:", !!omCurrentData,
      "OMH:", !!omHourlyData,
      "OMD7:", !!omDaily7,
      "OMS:", !!omStormData,
      "ACCU:", !!accuData,
      "VCM:", !!vcMonthlyData,
      "VC7:", !!vc7,
      "MB:", !!meteoblueData,
      "CWX:", !!checkwxData
    );

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

    var hourly = buildHourlyFromOpenMeteo(omHourlyData, currentTemp);
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
      omCurrentData && omCurrentData.current ? omCurrentData.current.apparent_temperature : null,
      tmCurrent.feelsLike,
      waCurr.feelslike_c,
      owData && owData.main ? owData.main.feels_like : null
    );

    var lightningBoost = getLightningBoost(wbCurrent);
    var stormProbability = computeStormProbability(
      first(omStorm.precipitation_probability, rainChance),
      first(mbCurrent.cloudCover, tmCurrent.cloudCover),
      omStorm.cape,
      lightningBoost
    );

    var weatherCode = first(
      owData && owData.weather && owData.weather[0] ? owmCodeToWMO(owData.weather[0].id) : null,
      waCodeToWMO(waCurr.condition ? waCurr.condition.code : 1000)
    );

    var conditionText = getWeatherText(weatherCode, first(waCurr.is_day, 1));

    var skyMetrics = {
      realfeel_shade: realFeel != null ? roundVal(realFeel - 3) : null,
      cloud_cover: roundVal(first(mbCurrent.cloudCover, tmCurrent.cloudCover)),
      cloud_ceiling: checkwxCeilingFeet != null ? roundVal(checkwxCeilingFeet / 3280.84) : null,
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

    if (!result.location.name || result.location.name === "Unknown" || result.location.name === "") {
      if (waLoc.name) {
        result.location.name = waLoc.name;
        result.location.region = waLoc.region || "";
        result.location.country = waLoc.country || "";
      }
    }

    putC(cKey, result);

    console.log("CheckWX ceiling feet:", checkwxCeilingFeet);
    console.log("Accu pollen:", accuPollen);
    console.log("Storm inputs:", {
      precip_probability: first(omStorm.precipitation_probability, rainChance),
      cloud_cover: first(mbCurrent.cloudCover, tmCurrent.cloudCover),
      cape: omStorm.cape,
      lightningBoost: lightningBoost,
      final: stormProbability
    });

    console.log(
      "=== Done. Hourly:", hourly.time.length,
      "Daily:", dTime.length,
      "Monthly:", monthly.length,
      "CurrentTemp:", result.current.temperature_c,
      "RealFeel:", result.current.feelslike_c,
      "Recommendations:", recommendations.length,
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