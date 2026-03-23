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
const ACCUWEATHER_KEY = process.env.ACCUWEATHER_API_KEY;

/* ───── CACHE ───── */

var generalCache = {};
var accuLocationCache = {};
var accuForecastCache = {};

var GENERAL_CACHE_MS = 30 * 60 * 1000;
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

function sf(url, label) {
  return fetch(url)
    .then(function (r) {
      if (!r.ok) {
        return r.text().catch(function () { return ""; }).then(function (t) {
          console.log(label + " HTTP " + r.status + ": " + t.substring(0, 400));
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

/* ───── AQI ───── */

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
      "&fields=temperature,temperatureApparent" +
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
    "https://api.weatherbit.io/v2.0/forecast/daily?lat=" + loc.lat + "&lon=" + loc.lon + "&days=10&key=" + WEATHERBIT_KEY,
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

async function fetchAccuLocationKey(loc) {
  if (!ACCUWEATHER_KEY) return null;

  var key = makeCK(loc.lat, loc.lon);
  var cached = getCached(accuLocationCache, key, ACCU_LOCATION_CACHE_MS);
  if (cached) return cached;

  var url =
    "http://dataservice.accuweather.com/locations/v1/cities/geoposition/search?apikey=" +
    ACCUWEATHER_KEY + "&q=" + loc.lat + "%2C" + loc.lon;

  var data = await sf(url, "AccuWeather-Location");
  if (data && data.Key) {
    setCached(accuLocationCache, key, data.Key);
    return data.Key;
  }
  return null;
}

async function fetchAccuForecast(loc) {
  if (!ACCUWEATHER_KEY) return null;

  var key = makeCK(loc.lat, loc.lon);
  var cached = getCached(accuForecastCache, key, ACCU_FORECAST_CACHE_MS);
  if (cached) {
    console.log("AccuWeather forecast cache hit:", key);
    return cached;
  }

  var locationKey = await fetchAccuLocationKey(loc);
  if (!locationKey) return null;

  var url =
    "http://dataservice.accuweather.com/forecasts/v1/daily/10day/" +
    locationKey +
    "?apikey=" + ACCUWEATHER_KEY +
    "&metric=true&details=true";

  var data = await sf(url, "AccuWeather-10Day");
  if (data && data.DailyForecasts) {
    setCached(accuForecastCache, key, data);
  }
  return data;
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

/* ───── PARSE TOMORROW CURRENT ───── */

function parseTomorrowCurrent(tmData) {
  var temp = null;
  var feels = null;

  if (tmData && tmData.data && tmData.data.timelines && tmData.data.timelines.length) {
    var intervals = tmData.data.timelines[0].intervals || [];
    if (intervals.length && intervals[0].values) {
      temp = intervals[0].values.temperature;
      feels = intervals[0].values.temperatureApparent;
    }
  }

  return { temp: temp, feelsLike: feels };
}

/* ───── HOURLY ───── */

function buildHourlyFromPirateAndWB(wbCurrent, prData, tz) {
  var time = [], temp = [], code = [], isDay = [];
  var nowEpoch = Math.floor(Date.now() / 1000);

  if (wbCurrent && wbCurrent.data && wbCurrent.data.length) {
    var c = wbCurrent.data[0];
    var currentLocal = epochToLocalISO(nowEpoch, tz);
    time.push(currentLocal);
    temp.push(first(c.temp, c.app_temp));
    code.push(wbCodeToWMO(c.weather ? c.weather.code : 800));
    var currentHour = parseInt(currentLocal.substring(11, 13));
    isDay.push((currentHour >= 6 && currentHour < 18) ? 1 : 0);
  }

  if (prData && prData.hourly && prData.hourly.data) {
    var existingKeys = {};
    for (var i = 0; i < time.length; i++) {
      existingKeys[time[i].substring(0, 13)] = true;
    }

    var ph = prData.hourly.data;
    for (var j = 0; j < ph.length && time.length < 24; j++) {
      var pEpoch = ph[j].time || 0;
      if (pEpoch < nowEpoch) continue;

      var localStr = epochToLocalISO(pEpoch, tz);
      var hourKey = localStr.substring(0, 13);
      if (existingKeys[hourKey]) continue;

      var localHour = parseInt(localStr.substring(11, 13));
      time.push(localStr);
      temp.push(ph[j].temperature);
      code.push(pirateToWMO(ph[j].icon));
      isDay.push((localHour >= 6 && localHour < 18) ? 1 : 0);
      existingKeys[hourKey] = true;
    }
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

/* ───── DAILY 10 DAYS FROM ACCUWEATHER ───── */

function buildDaily(accuData) {
  var out = [];
  if (!accuData || !accuData.DailyForecasts) return out;

  var list = accuData.DailyForecasts;
  var count = Math.min(10, list.length);

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
        d.Night && d.Night.IconPhrase ? d.Night.IconPhrase :
        ""
      ),
      max_temp: d.Temperature && d.Temperature.Maximum ? d.Temperature.Maximum.Value : null,
      min_temp: d.Temperature && d.Temperature.Minimum ? d.Temperature.Minimum.Value : null,
      precip_chance: d.Day && d.Day.PrecipitationProbability != null ? d.Day.PrecipitationProbability : null,
      sunrise: d.Sun && d.Sun.Rise ? new Date(d.Sun.Rise).toISOString().substring(0, 19) : null,
      sunset: d.Sun && d.Sun.Set ? new Date(d.Sun.Set).toISOString().substring(0, 19) : null,
      uv: uvVal
    });
  }

  return out;
}

/* ───── MONTHLY = VC HISTORY + 10-DAY FORECAST OVERLAY ───── */

function buildMonthly(vcMonthlyData, dailyArray) {
  var map = {};

  if (vcMonthlyData && vcMonthlyData.days) {
    for (var i = 0; i < vcMonthlyData.days.length; i++) {
      var d = vcMonthlyData.days[i];
      if (!d.datetime) continue;
      map[d.datetime] = {
        date: d.datetime,
        weather_code: vcToWMO(first(d.icon, d.conditions, "")),
        max_temp: d.tempmax != null ? d.tempmax : null,
        min_temp: d.tempmin != null ? d.tempmin : null
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
      min_temp: dy.min_temp
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
      fetchWeatherbitCurrent(loc),
      fetchWeatherbitDaily(loc),
      fetchPirate(loc),
      fetchOpenWeather(loc),
      fetchAccuForecast(loc),
      fetchVisualCrossingMonthly(loc)
    ]);

    var waData = results[0];
    var tmCurrentData = results[1];
    var wbCurrent = results[2];
    var wbDaily = results[3];
    var prData = results[4];
    var owData = results[5];
    var accuData = results[6];
    var vcMonthlyData = results[7];

    console.log(
      "API Status — WA:", !!waData,
      "TM:", !!tmCurrentData,
      "WBC:", !!wbCurrent,
      "WBD:", !!wbDaily,
      "PR:", !!prData,
      "OW:", !!owData,
      "ACCU:", !!accuData,
      "VCM:", !!vcMonthlyData
    );

    if (!waData) {
      return res.status(503).json({ error: "Primary weather API unavailable" });
    }

    var waCurr = waData.current || {};
    var waLoc = waData.location || {};
    var tz = waLoc.tz_id || "UTC";
    var tmCurrent = parseTomorrowCurrent(tmCurrentData);

    // Hourly
    var hourly = buildHourlyFromPirateAndWB(wbCurrent, prData, tz);

    // Current temp
    var currentTemp = first(
      tmCurrent.temp,
      hourly.temperature_2m && hourly.temperature_2m.length ? hourly.temperature_2m[0] : null,
      wbCurrent && wbCurrent.data && wbCurrent.data[0] ? first(wbCurrent.data[0].temp, wbCurrent.data[0].app_temp) : null,
      owData && owData.main ? owData.main.temp : null,
      waCurr.temp_c
    );

    if (hourly.temperature_2m && hourly.temperature_2m.length && currentTemp != null) {
      hourly.temperature_2m[0] = currentTemp;
    }

    // Time periods
    var timePeriods = buildTimePeriodsFromHourly(hourly, prData, tz);

    // Daily 10 days from AccuWeather
    var dailyArray = buildDaily(accuData);

    // Monthly = VC history + same 10-day future
    var monthly = buildMonthly(vcMonthlyData, dailyArray);

    // AQ
    var pm25 = buildAQ(waData, wbDaily);

    // Rain chance
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

    // Visibility
    var visibility = null;
    if (owData && owData.visibility != null) visibility = owData.visibility;
    if (visibility == null && waCurr.vis_km != null) visibility = waCurr.vis_km * 1000;

    // Humidity
    var humidity = null;
    if (owData && owData.main && owData.main.humidity != null) humidity = owData.main.humidity;
    if (humidity == null) humidity = waCurr.humidity;

    // UV
    var uv = null;
    if (dailyArray.length && dailyArray[0].uv != null) uv = dailyArray[0].uv;
    if (uv == null && wbDaily && wbDaily.data && wbDaily.data[0]) uv = first(wbDaily.data[0].uv, wbDaily.data[0].max_uv);
    if (uv == null) uv = waCurr.uv;

    // Daily arrays
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
        temperature_c: currentTemp,
        weather_code: waCodeToWMO(waCurr.condition ? waCurr.condition.code : 1000),
        condition_text: waCurr.condition ? waCurr.condition.text : null,
        is_day: first(waCurr.is_day, 1),
        feelslike_c: first(
          waCurr.feelslike_c,
          tmCurrent.feelsLike,
          owData && owData.main ? owData.main.feels_like : null
        ),
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

    console.log(
      "=== Done. Hourly:", hourly.time.length,
      "Daily:", dTime.length,
      "Monthly:", monthly.length,
      "CurrentTemp:", currentTemp,
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