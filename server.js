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

function cacheKey(lat, lon) {
  return (Math.round(lat * 10) / 10) + "," + (Math.round(lon * 10) / 10);
}

function getCache(key) {
  var e = cache[key];
  if (!e) return null;
  if (Date.now() - e.time > CACHE_DURATION) { delete cache[key]; return null; }
  return e.data;
}

function putCache(key, data) {
  var keys = Object.keys(cache);
  if (keys.length > 300) {
    var sorted = keys.sort(function(a,b){ return (cache[a].time||0)-(cache[b].time||0); });
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
    .then(function(r) {
      if (!r.ok) {
        return r.text().catch(function(){ return ""; }).then(function(t) {
          console.log(label + " HTTP " + r.status + ": " + t.substring(0, 200));
          return null;
        });
      }
      return r.json();
    })
    .catch(function(e) {
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
    if (d < best) { best = d; idx = i; }
  }
  return idx;
}

function waCodeToWMO(c) {
  var m = {1000:0,1003:2,1006:3,1009:3,1030:45,1063:61,1066:71,1069:66,1072:56,1087:95,1114:73,1117:75,1135:45,1147:48,1150:51,1153:51,1168:56,1171:57,1180:61,1183:61,1186:63,1189:63,1192:65,1195:65,1198:66,1201:67,1204:66,1207:67,1210:71,1213:71,1216:73,1219:73,1222:75,1225:75,1237:77,1240:80,1243:81,1246:82,1249:85,1252:86,1255:85,1258:86,1261:77,1264:77,1273:95,1276:95,1279:95,1282:96};
  return m[c] !== undefined ? m[c] : 0;
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
  if (i.indexOf("wind") >= 0) return 3;
  return 2;
}

function wbCodeToWMO(c) {
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

function msToWMO(id) {
  if (!id || typeof id !== "number") return 0;
  if (id === 1) return 0;
  if (id === 2) return 1;
  if (id === 3 || id === 4) return 2;
  if (id === 5 || id === 6) return 3;
  if (id === 7) return 45;
  if (id >= 8 && id <= 10) return 61;
  if (id >= 11 && id <= 13) return 63;
  if (id >= 14 && id <= 17) return 65;
  if (id >= 18 && id <= 20) return 73;
  if (id >= 21 && id <= 23) return 95;
  return 2;
}

function pirateToWMO(icon) {
  if (!icon) return 0;
  var i = icon.toLowerCase();
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

function owmToWMO(id) {
  if (id >= 200 && id < 300) return 95;
  if (id >= 300 && id < 400) return 51;
  if (id >= 500 && id < 510) return 63;
  if (id >= 520 && id < 600) return 80;
  if (id >= 600 && id < 700) return 73;
  if (id >= 700 && id < 800) return 45;
  if (id === 800) return 0;
  if (id === 801) return 1;
  if (id === 802) return 2;
  if (id >= 803) return 3;
  return 0;
}

/* ───── LOCATION ───── */

var PRESETS = {
  moga: { key:"moga", name:"Moga", region:"Punjab", country:"India", lat:30.8165, lon:75.1717 }
};

async function resolveLoc(q) {
  var city = (q.city||"").trim(), ck = city.toLowerCase();
  var lat = q.lat != null ? Number(q.lat) : null;
  var lon = q.lon != null ? Number(q.lon) : null;

  if (lat != null && lon != null && !isNaN(lat) && !isNaN(lon)) {
    var r = await sf("https://api.weatherapi.com/v1/search.json?key=" + WEATHERAPI_KEY + "&q=" + lat + "," + lon, "RevGeo");
    if (r && r.length) return { key:"coords", name:r[0].name||"", region:r[0].region||"", country:r[0].country||"", lat:lat, lon:lon };
    return { key:"coords", name:"", region:"", country:"", lat:lat, lon:lon };
  }

  if (ck && PRESETS[ck]) return PRESETS[ck];

  if (city) {
    var wa = await sf("https://api.weatherapi.com/v1/search.json?key=" + WEATHERAPI_KEY + "&q=" + encodeURIComponent(city), "WA-Geo");
    if (wa && wa.length) return { key:ck, name:wa[0].name||city, region:wa[0].region||"", country:wa[0].country||"", lat:wa[0].lat, lon:wa[0].lon };

    var om = await sf("https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(city) + "&count=1&language=en&format=json", "OM-Geo");
    if (om && om.results && om.results[0]) {
      var p = om.results[0];
      return { key:ck, name:p.name||city, region:p.admin1||"", country:p.country||"", lat:p.latitude, lon:p.longitude };
    }
  }

  return PRESETS.moga;
}

async function resolveIp() {
  var g = await sf("https://ipapi.co/json/", "IPAPI");
  if (!g || !g.latitude) return PRESETS.moga;
  return { key:"ip", name:g.city||"Unknown", region:g.region||"", country:g.country_name||"", lat:Number(g.latitude), lon:Number(g.longitude) };
}

/* ───── API FETCHERS ───── */

async function fetchWeatherApi(loc) {
  return await sf("https://api.weatherapi.com/v1/forecast.json?key=" + WEATHERAPI_KEY + "&q=" + loc.lat + "," + loc.lon + "&days=3&aqi=yes&alerts=no", "WeatherAPI");
}

async function fetchTomorrow(loc) {
  return await sf("https://api.tomorrow.io/v4/weather/forecast?location=" + loc.lat + "," + loc.lon + "&timesteps=1h&apikey=" + TOMORROW_KEY, "Tomorrow");
}

async function fetchPirate(loc) {
  return await sf("https://api.pirateweather.net/forecast/" + PIRATE_KEY + "/" + loc.lat + "," + loc.lon + "?units=si", "Pirate");
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
  var y = now.getFullYear(), m = String(now.getMonth()+1).padStart(2,"0");
  var monthStart = y + "-" + m + "-01";

  var endDate = new Date(now);
  endDate.setDate(endDate.getDate() + 15);
  var endStr = endDate.toISOString().split("T")[0];

  return await sf("https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/" + loc.lat + "," + loc.lon + "/" + monthStart + "/" + endStr + "?key=" + VISUALCROSSING_KEY + "&unitGroup=metric&include=days", "VisualCrossing");
}

async function fetchOpenMeteo(loc) {
  return await sf("https://api.open-meteo.com/v1/forecast?latitude=" + loc.lat + "&longitude=" + loc.lon + "&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=16", "OpenMeteo");
}

/* ───── BUILD TIME PERIODS ───── */

function buildTimePeriods(tomorrowData, pirateData, timezone) {
  var hours = [];

  // Get hourly data from Tomorrow.io
  if (tomorrowData && tomorrowData.timelines && tomorrowData.timelines.hourly) {
    var th = tomorrowData.timelines.hourly;
    for (var i = 0; i < th.length; i++) {
      hours.push({
        time: th[i].time,
        temp: th[i].values ? th[i].values.temperature : null,
        code: th[i].values ? th[i].values.weatherCode : null,
        precip: th[i].values ? th[i].values.precipitationProbability : null,
        source: "tomorrow"
      });
    }
  }

  // Fill in from Pirate Weather
  if (pirateData && pirateData.hourly && pirateData.hourly.data) {
    var ph = pirateData.hourly.data;
    for (var j = 0; j < ph.length; j++) {
      var pt = new Date(ph[j].time * 1000).toISOString();
      var exists = false;
      for (var k = 0; k < hours.length; k++) {
        if (Math.abs(new Date(hours[k].time).getTime() - new Date(pt).getTime()) < 1800000) {
          exists = true;
          break;
        }
      }
      if (!exists) {
        hours.push({
          time: pt,
          temp: ph[j].temperature,
          code: pirateToWMO(ph[j].icon),
          precip: ph[j].precipProbability != null ? Math.round(ph[j].precipProbability * 100) : null,
          source: "pirate"
        });
      }
    }
  }

  hours.sort(function(a, b) { return new Date(a.time) - new Date(b.time); });

  // Convert tomorrow.io weather codes to WMO
  for (var m = 0; m < hours.length; m++) {
    if (hours[m].source === "tomorrow" && hours[m].code != null) {
      hours[m].code = tomorrowCodeToWMO(hours[m].code);
    }
  }

  // Define periods
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  var periods = [
    { name: "Morning", startH: 6, endH: 12 },
    { name: "Afternoon", startH: 12, endH: 17 },
    { name: "Evening", startH: 17, endH: 21 },
    { name: "Overnight", startH: 21, endH: 30 } // 30 = 6 AM next day
  ];

  var result = [];

  for (var p = 0; p < periods.length; p++) {
    var period = periods[p];
    var startTime, endTime;

    if (period.endH <= 24) {
      startTime = new Date(today.getTime() + period.startH * 3600000);
      endTime = new Date(today.getTime() + period.endH * 3600000);
    } else {
      startTime = new Date(today.getTime() + period.startH * 3600000);
      endTime = new Date(today.getTime() + (period.endH) * 3600000);
    }

    // If period already passed, shift to tomorrow
    if (endTime < now) {
      startTime = new Date(startTime.getTime() + 86400000);
      endTime = new Date(endTime.getTime() + 86400000);
    }

    var temps = [];
    var codes = {};
    var precips = [];

    for (var h = 0; h < hours.length; h++) {
      var ht = new Date(hours[h].time);
      if (ht >= startTime && ht < endTime) {
        if (hours[h].temp != null) temps.push(hours[h].temp);
        if (hours[h].code != null) {
          var c = hours[h].code;
          codes[c] = (codes[c] || 0) + 1;
        }
        if (hours[h].precip != null) precips.push(hours[h].precip);
      }
    }

    var avgTemp = temps.length ? Math.round(temps.reduce(function(a,b){return a+b;},0) / temps.length) : null;
    var avgPrecip = precips.length ? Math.round(precips.reduce(function(a,b){return a+b;},0) / precips.length) : null;

    // Most common weather code
    var dominantCode = 0;
    var maxCount = 0;
    var codeKeys = Object.keys(codes);
    for (var ck = 0; ck < codeKeys.length; ck++) {
      if (codes[codeKeys[ck]] > maxCount) {
        maxCount = codes[codeKeys[ck]];
        dominantCode = Number(codeKeys[ck]);
      }
    }

    result.push({
      name: period.name,
      temp: avgTemp,
      weather_code: dominantCode,
      precip_chance: avgPrecip,
      has_data: temps.length > 0
    });
  }

  return result;
}

function tomorrowCodeToWMO(code) {
  var map = {
    0: 0, 1000: 0, 1100: 1, 1101: 2, 1102: 3, 1001: 3,
    2000: 45, 2100: 45,
    4000: 51, 4001: 63, 4200: 61, 4201: 65,
    5000: 73, 5001: 75, 5100: 71, 5101: 75,
    6000: 56, 6001: 67, 6200: 66, 6201: 67,
    7000: 77, 7101: 77, 7102: 77,
    8000: 95
  };
  return map[code] !== undefined ? map[code] : 0;
}

/* ───── BUILD HOURLY ───── */

function buildHourly(tomorrowData, pirateData) {
  var hours = [];
  var now = new Date();

  // Next 6 hours from Tomorrow.io
  if (tomorrowData && tomorrowData.timelines && tomorrowData.timelines.hourly) {
    var th = tomorrowData.timelines.hourly;
    var count = 0;
    for (var i = 0; i < th.length && count < 7; i++) {
      var t = new Date(th[i].time);
      if (t >= new Date(now.getTime() - 1800000)) {
        var v = th[i].values || {};
        hours.push({
          time: th[i].time,
          temp: v.temperature != null ? v.temperature : null,
          weather_code: v.weatherCode != null ? tomorrowCodeToWMO(v.weatherCode) : 0,
          is_day: (t.getHours() >= 6 && t.getHours() < 18) ? 1 : 0
        });
        count++;
      }
    }
  }

  // Remaining hours from Pirate Weather (up to 24 total)
  if (pirateData && pirateData.hourly && pirateData.hourly.data) {
    var ph = pirateData.hourly.data;
    for (var j = 0; j < ph.length && hours.length < 24; j++) {
      var pt = new Date(ph[j].time * 1000);
      if (pt < now) continue;

      var exists = false;
      for (var k = 0; k < hours.length; k++) {
        if (Math.abs(new Date(hours[k].time).getTime() - pt.getTime()) < 1800000) {
          exists = true;
          break;
        }
      }

      if (!exists) {
        hours.push({
          time: pt.toISOString(),
          temp: ph[j].temperature != null ? ph[j].temperature : null,
          weather_code: pirateToWMO(ph[j].icon),
          is_day: (pt.getHours() >= 6 && pt.getHours() < 18) ? 1 : 0
        });
      }
    }
  }

  hours.sort(function(a, b) { return new Date(a.time) - new Date(b.time); });

  var time = [], temp = [], code = [], isDay = [];
  for (var h = 0; h < hours.length; h++) {
    time.push(hours[h].time);
    temp.push(hours[h].temp);
    code.push(hours[h].weather_code);
    isDay.push(hours[h].is_day);
  }

  return { time: time, temperature_2m: temp, weather_code: code, is_day: isDay };
}

/* ───── BUILD DAILY (15 DAYS) ───── */

function buildDaily(waData, wbData, msData, vcData, omData) {
  var days = {};

  // Days 1-3 from WeatherAPI (conditions) + Weatherbit (temps)
  if (waData && waData.forecast && waData.forecast.forecastday) {
    var waDays = waData.forecast.forecastday;
    for (var i = 0; i < waDays.length && i < 3; i++) {
      var d = waDays[i];
      var dd = d.day || {};
      var astro = d.astro || {};
      days[d.date] = {
        date: d.date,
        weather_code: waCodeToWMO(dd.condition ? dd.condition.code : 1000),
        max_temp: null,
        min_temp: null,
        precip_chance: dd.daily_chance_of_rain || 0,
        sunrise: d.date + "T" + c12to24(astro.sunrise),
        sunset: d.date + "T" + c12to24(astro.sunset),
        uv: null
      };
    }
  }

  // Weatherbit temps + UV for days 1-7
  if (wbData && wbData.data) {
    for (var j = 0; j < wbData.data.length; j++) {
      var wb = wbData.data[j];
      var wbDate = wb.datetime || wb.valid_date;
      if (!wbDate) continue;

      if (days[wbDate]) {
        days[wbDate].max_temp = wb.max_temp || wb.high_temp;
        days[wbDate].min_temp = wb.min_temp || wb.low_temp;
        days[wbDate].uv = wb.uv;
      } else if (j >= 3 && j < 7) {
        // Days 4-7: Weatherbit temps, conditions from Meteosource
        days[wbDate] = {
          date: wbDate,
          weather_code: wbCodeToWMO(wb.weather ? wb.weather.code : 800),
          max_temp: wb.max_temp || wb.high_temp,
          min_temp: wb.min_temp || wb.low_temp,
          precip_chance: wb.pop || 0,
          sunrise: null,
          sunset: null,
          uv: wb.uv
        };
      }
    }
  }

  // Meteosource conditions for days 4-7
  if (msData && msData.daily && msData.daily.data) {
    var msDays = msData.daily.data;
    for (var m = 0; m < msDays.length; m++) {
      var ms = msDays[m];
      var msDate = ms.day;
      if (!msDate) continue;

      if (days[msDate] && !waData) {
        days[msDate].weather_code = msToWMO(ms.weather);
      } else if (days[msDate]) {
        // Only override conditions for days 4+
        var dayKeys = Object.keys(days).sort();
        var dayIndex = dayKeys.indexOf(msDate);
        if (dayIndex >= 3) {
          days[msDate].weather_code = msToWMO(ms.weather);
        }
      } else {
        days[msDate] = {
          date: msDate,
          weather_code: msToWMO(ms.weather),
          max_temp: ms.all_day ? ms.all_day.temperature_max : null,
          min_temp: ms.all_day ? ms.all_day.temperature_min : null,
          precip_chance: ms.all_day ? ms.all_day.precipitation_total : 0,
          sunrise: null,
          sunset: null,
          uv: null
        };
      }
    }
  }

  // Visual Crossing for days 8-15 (conditions)
  if (vcData && vcData.days) {
    for (var v = 0; v < vcData.days.length; v++) {
      var vc = vcData.days[v];
      if (!vc.datetime) continue;

      if (!days[vc.datetime]) {
        days[vc.datetime] = {
          date: vc.datetime,
          weather_code: vcToWMO(vc.icon || vc.conditions),
          max_temp: vc.tempmax,
          min_temp: vc.tempmin,
          precip_chance: vc.precipprob || 0,
          sunrise: vc.datetime + "T" + (vc.sunrise || "06:00:00"),
          sunset: vc.datetime + "T" + (vc.sunset || "18:00:00"),
          uv: vc.uvindex
        };
      } else {
        // Fill in missing sunrise/sunset
        if (!days[vc.datetime].sunrise && vc.sunrise) {
          days[vc.datetime].sunrise = vc.datetime + "T" + vc.sunrise;
        }
        if (!days[vc.datetime].sunset && vc.sunset) {
          days[vc.datetime].sunset = vc.datetime + "T" + vc.sunset;
        }
      }
    }
  }

  // Open-Meteo temps for days 8-15
  if (omData && omData.daily && omData.daily.time) {
    var omd = omData.daily;
    for (var o = 0; o < omd.time.length; o++) {
      var omDate = omd.time[o];
      if (days[omDate]) {
        // Override temps for days 8+ if not already set or if from VC
        var sortedKeys = Object.keys(days).sort();
        var omIdx = sortedKeys.indexOf(omDate);
        if (omIdx >= 7) {
          days[omDate].max_temp = first(omd.temperature_2m_max ? omd.temperature_2m_max[o] : null, days[omDate].max_temp);
          days[omDate].min_temp = first(omd.temperature_2m_min ? omd.temperature_2m_min[o] : null, days[omDate].min_temp);
        }
      }
    }
  }

  // Sort and limit to 15 days
  var sorted = Object.values(days).sort(function(a, b) {
    return new Date(a.date) - new Date(b.date);
  });

  var now = new Date();
  var todayStr = now.toISOString().split("T")[0];
  var filtered = sorted.filter(function(d) { return d.date >= todayStr; });

  return filtered.slice(0, 15);
}

/* ───── BUILD MONTHLY ───── */

function buildMonthly(vcData) {
  var monthly = [];

  if (vcData && vcData.days) {
    for (var i = 0; i < vcData.days.length; i++) {
      var d = vcData.days[i];
      monthly.push({
        date: d.datetime,
        weather_code: vcToWMO(d.icon || d.conditions),
        max_temp: d.tempmax,
        min_temp: d.tempmin
      });
    }
  }

  return monthly;
}

/* ───── BUILD AIR QUALITY (BLENDED) ───── */

function buildAirQuality(waData, wbData, owmData) {
  var values = [];

  // WeatherAPI PM2.5
  if (waData && waData.current && waData.current.air_quality) {
    var waPm = waData.current.air_quality.pm2_5;
    if (waPm != null && !isNaN(waPm)) values.push(waPm);
  }

  // Weatherbit AQI (approximate PM2.5)
  if (wbData && wbData.data && wbData.data[0]) {
    var wbAqi = wbData.data[0].aqi;
    if (wbAqi != null && !isNaN(wbAqi)) {
      // Rough AQI to PM2.5 conversion
      var wbPm = wbAqi * 0.3;
      values.push(wbPm);
    }
  }

  // OpenWeather (no direct PM2.5 in basic call, but we try)
  if (owmData && owmData.main) {
    // OpenWeather basic doesn't include AQI, skip
  }

  if (values.length === 0) return null;

  var avg = values.reduce(function(a, b) { return a + b; }, 0) / values.length;
  return Math.round(avg * 10) / 10;
}

/* ───── ROUTES ───── */

app.get("/", function(req, res) {
  res.send("RealWeather backend running");
});

app.get("/api/search", async function(req, res) {
  try {
    var q = (req.query.q || "").trim();
    if (!q) return res.json({ results: [] });

    var wa = await sf("https://api.weatherapi.com/v1/search.json?key=" + WEATHERAPI_KEY + "&q=" + encodeURIComponent(q), "Search");
    if (wa && wa.length) {
      return res.json({ results: wa.map(function(i) { return { name: i.name||"", region: i.region||"", country: i.country||"", latitude: i.lat, longitude: i.lon }; }) });
    }

    var om = await sf("https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(q) + "&count=8&language=en&format=json", "OM-Search");
    if (om && om.results) {
      return res.json({ results: om.results.map(function(i) { return { name: i.name||"", region: i.admin1||"", country: i.country||"", latitude: i.latitude, longitude: i.longitude }; }) });
    }

    res.json({ results: [] });
  } catch(e) {
    console.log("SEARCH ERR:", e);
    res.status(500).json({ results: [] });
  }
});

app.get("/api/weather", async function(req, res) {
  try {
    var loc;
    if (req.query.lat != null || req.query.lon != null || req.query.city) {
      loc = await resolveLoc(req.query);
    } else {
      loc = await resolveIp();
    }

    var ck = cacheKey(loc.lat, loc.lon);
    var cached = getCache(ck);
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

    // Fetch all APIs in parallel
    var results = await Promise.all([
      fetchWeatherApi(loc),     // 0: current, days 1-3, AQI, sunrise/sunset
      fetchTomorrow(loc),       // 1: hourly 6h, wind, realfeel
      fetchPirate(loc),         // 2: hourly 18h, rain chance
      fetchWeatherbit(loc),     // 3: days 1-7 temps, UV, AQI
      fetchMeteosource(loc),    // 4: days 4-7 conditions
      fetchOpenWeather(loc),    // 5: humidity, visibility
      fetchVisualCrossing(loc), // 6: days 8-15, historical, monthly
      fetchOpenMeteo(loc)       // 7: days 8-15 temps
    ]);

    var waData = results[0];
    var tmData = results[1];
    var prData = results[2];
    var wbData = results[3];
    var msData = results[4];
    var owData = results[5];
    var vcData = results[6];
    var omData = results[7];

    console.log("WA:", waData?"OK":"FAIL",
      "TM:", tmData?"OK":"FAIL",
      "PR:", prData?"OK":"FAIL",
      "WB:", wbData?"OK":"FAIL",
      "MS:", msData?"OK":"FAIL",
      "OW:", owData?"OK":"FAIL",
      "VC:", vcData?"OK":"FAIL",
      "OM:", omData?"OK":"FAIL");

    if (!waData && !tmData && !prData) {
      return res.status(503).json({ error: "Weather APIs unavailable" });
    }

    // Current conditions from WeatherAPI
    var waCurr = waData ? waData.current || {} : {};
    var waLoc = waData ? waData.location || {} : {};

    // Tomorrow.io current values
    var tmCurr = {};
    if (tmData && tmData.timelines && tmData.timelines.hourly && tmData.timelines.hourly.length) {
      var tmIdx = nearIdx(tmData.timelines.hourly.map(function(h){return h.time;}));
      tmCurr = tmData.timelines.hourly[tmIdx].values || {};
    }

    // Pirate current
    var prCurr = prData && prData.currently ? prData.currently : {};

    // Weatherbit current (first day)
    var wbCurr = wbData && wbData.data && wbData.data[0] ? wbData.data[0] : {};

    // Build components
    var hourly = buildHourly(tmData, prData);
    var timePeriods = buildTimePeriods(tmData, prData);
    var dailyArray = buildDaily(waData, wbData, msData, vcData, omData);
    var monthly = buildMonthly(vcData);
    var blendedPm25 = buildAirQuality(waData, wbData, owData);

    // Build daily arrays for frontend
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

    // Sunrise/sunset for today
    var todaySunrise = dSunrise[0] || null;
    var todaySunset = dSunset[0] || null;
    var tomorrowSunrise = dSunrise[1] || dSunrise[0] || null;

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
        feelslike_c: first(tmCurr.temperatureApparent, waCurr.feelslike_c),
        humidity: first(owData ? owData.main ? owData.main.humidity : null : null, waCurr.humidity),
        wind_kph: first(tmCurr.windSpeed != null ? tmCurr.windSpeed * 3.6 : null, waCurr.wind_kph),
        wind_degree: first(waCurr.wind_degree),
        pressure_hpa: first(waCurr.pressure_mb),
        visibility: first(owData ? owData.visibility : null),
        rain_chance: first(prCurr.precipProbability != null ? Math.round(prCurr.precipProbability * 100) : null),
        uv: first(wbCurr.uv, waCurr.uv),
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

    putCache(ck, result);

    console.log("Done. Hourly:", hourly.time.length,
      "Daily:", dTime.length,
      "Monthly:", monthly.length,
      "Periods:", timePeriods.length);

    res.json(result);
  } catch(e) {
    console.log("ERROR:", e);
    res.status(500).json({ error: "Failed" });
  }
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log("Server on http://localhost:" + PORT);
});