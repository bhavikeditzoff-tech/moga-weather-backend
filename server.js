require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const WEATHERAPI_KEY      = process.env.WEATHERAPI_KEY;
const TOMORROW_KEY        = process.env.TOMORROW_API_KEY;
const PIRATE_KEY          = process.env.PIRATE_WEATHER_KEY;
const ACCUWEATHER_API_KEY = process.env.ACCUWEATHER_API_KEY;
const CHECKWX_API_KEY     = process.env.CHECKWX_API_KEY;
const GEMINI_KEY          = process.env.GEMINI_API_KEY;
const GROQ_KEY            = process.env.GROQ_API_KEY;
const CEREBRAS_KEY        = process.env.CEREBRAS_API_KEY;
const APIFREELLM_KEY      = process.env.APIFREELLM_API_KEY;
const TAVILY_KEY          = process.env.TAVILY_API_KEY;
const EXA_KEY             = process.env.EXA_AI_API_KEY;

/* ───── CACHE ───── */
var generalCache          = {};
var accuLocationCache     = {};
var accuForecastCache     = {};
var recommendationsCache  = {};
var monthlyCache          = {};
var openMeteoCurrentCache = {};

var GENERAL_CACHE_MS          = 10 * 60 * 1000;
var ACCU_LOCATION_CACHE_MS    = 7 * 24 * 60 * 60 * 1000;
var ACCU_FORECAST_CACHE_MS    = 6 * 60 * 60 * 1000;
var RECOMMENDATIONS_CACHE_MS  = 60 * 60 * 1000;
var MONTHLY_CACHE_MS          = 24 * 60 * 60 * 1000;
var OPENMETEO_CURRENT_CACHE_MS = 10 * 60 * 1000;

function getCached(store, key, maxAge) {
  var entry = store[key];
  if (!entry) return null;
  if (Date.now() - entry.time > maxAge) { delete store[key]; return null; }
  return entry.data;
}
function setCached(store, key, data) {
  var keys = Object.keys(store);
  if (keys.length > 300) {
    var sorted = keys.sort(function (a, b) { return (store[a].time||0)-(store[b].time||0); });
    for (var i=0;i<100;i++) delete store[sorted[i]];
  }
  store[key] = { data: data, time: Date.now() };
}
function makeCK(lat, lon) { return (Math.round(lat*10)/10)+","+(Math.round(lon*10)/10); }
function getC(key)        { return getCached(generalCache, key, GENERAL_CACHE_MS); }
function putC(key, data)  { setCached(generalCache, key, data); }

/* ───── HELPERS ───── */
function first() {
  for (var i=0;i<arguments.length;i++) {
    var v=arguments[i];
    if (v!==undefined&&v!==null&&v!==""&&!Number.isNaN(v)) return v;
  }
  return null;
}
function roundVal(v) { return v==null||isNaN(v)?null:Math.round(v); }
function avg(nums) {
  var clean=nums.filter(function(n){return n!=null&&!isNaN(n);});
  if (!clean.length) return null;
  return clean.reduce(function(a,b){return a+b;},0)/clean.length;
}
function majority(values) {
  var counts={},best=null,max=-1;
  for (var i=0;i<values.length;i++) {
    var v=values[i]; if (v==null) continue;
    counts[v]=(counts[v]||0)+1;
    if (counts[v]>max){max=counts[v];best=Number(v);}
  }
  return best;
}
function sf(url, label) {
  return fetch(url)
    .then(function(r){
      if (!r.ok) {
        return r.text().catch(function(){return "";}).then(function(t){
          console.log(label+" HTTP "+r.status+": "+t.substring(0,500));
          return null;
        });
      }
      return r.json();
    })
    .catch(function(e){console.log(label+" ERR: "+e.message);return null;});
}
function c12to24(t){
  if(!t)return"00:00:00";
  var p=t.split(" "),time=p[0],mod=p[1],tp=time.split(":");
  var h=tp[0],m=tp[1];
  if(h==="12")h="00";
  if(mod==="PM")h=String(parseInt(h,10)+12);
  return h.padStart(2,"0")+":"+m+":00";
}
function epochToLocalISO(epochSec,tz){
  var d=new Date(epochSec*1000);
  try{
    var parts=new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(d);
    var yy="",mm="",dd="",hh="",mi="";
    for(var i=0;i<parts.length;i++){
      if(parts[i].type==="year")  yy=parts[i].value;
      if(parts[i].type==="month") mm=parts[i].value;
      if(parts[i].type==="day")   dd=parts[i].value;
      if(parts[i].type==="hour")  hh=parts[i].value;
      if(parts[i].type==="minute")mi=parts[i].value;
    }
    return yy+"-"+mm+"-"+dd+"T"+hh+":"+mi+":00";
  }catch(e){return d.toISOString();}
}
function getLocalHour(epochSec,tz){
  try{
    var parts=new Intl.DateTimeFormat("en-US",{timeZone:tz,hour:"numeric",hourCycle:"h23"}).formatToParts(new Date(epochSec*1000));
    for(var i=0;i<parts.length;i++){if(parts[i].type==="hour")return parseInt(parts[i].value);}
  }catch(e){}
  return new Date(epochSec*1000).getUTCHours();
}
function getIsDayNow(tz){
  try{
    var parts=new Intl.DateTimeFormat("en-US",{timeZone:tz,hour:"numeric",hourCycle:"h23"}).formatToParts(new Date());
    var hh=12;
    for(var i=0;i<parts.length;i++){if(parts[i].type==="hour"){hh=parseInt(parts[i].value);break;}}
    return(hh>=6&&hh<18)?1:0;
  }catch(e){return 1;}
}

/* ───── CONVERTERS ───── */
function waCodeToWMO(c){
  var m={1000:0,1003:2,1006:3,1009:3,1030:45,1063:61,1066:71,1069:66,1072:56,1087:95,
    1114:73,1117:75,1135:45,1147:48,1150:51,1153:51,1168:56,1171:57,
    1180:61,1183:61,1186:63,1189:63,1192:65,1195:65,1198:66,1201:67,
    1204:66,1207:67,1210:71,1213:71,1216:73,1219:73,1222:75,1225:75,1237:77,
    1240:80,1243:81,1246:82,1249:85,1252:86,1255:85,1258:86,1261:77,1264:77,
    1273:95,1276:95,1279:95,1282:96};
  return m[c]!==undefined?m[c]:0;
}
function pirateToWMO(icon){
  if(!icon)return 0;
  var i=String(icon).toLowerCase();
  if(i==="clear-day"||i==="clear-night")return 0;
  if(i==="partly-cloudy-day"||i==="partly-cloudy-night")return 2;
  if(i==="cloudy")return 3;if(i==="fog")return 45;if(i==="rain")return 63;
  if(i==="sleet")return 66;if(i==="snow")return 73;if(i==="wind")return 3;
  return 2;
}
function accuPhraseToWMO(text){
  if(!text)return 0;
  var s=String(text).toLowerCase();
  if(s.indexOf("clear")>=0||s.indexOf("sunny")>=0)return 0;
  if(s.indexOf("mostly sunny")>=0)return 1;
  if(s.indexOf("partly cloudy")>=0||s.indexOf("partly sunny")>=0)return 2;
  if(s.indexOf("cloud")>=0||s.indexOf("overcast")>=0)return 3;
  if(s.indexOf("fog")>=0||s.indexOf("mist")>=0)return 45;
  if(s.indexOf("drizzle")>=0)return 51;
  if(s.indexOf("thunder")>=0||s.indexOf("storm")>=0)return 95;
  if(s.indexOf("snow")>=0)return 73;
  if(s.indexOf("sleet")>=0||s.indexOf("ice")>=0||s.indexOf("freezing rain")>=0)return 66;
  if(s.indexOf("shower")>=0)return 80;if(s.indexOf("rain")>=0)return 63;
  return 2;
}
function getWeatherText(code,isDay){
  if(isDay===undefined)isDay=1;
  if(code===0)return isDay?"Sunny":"Clear night";
  if(code===1)return isDay?"Mostly sunny":"Mostly clear";
  if(code===2)return isDay?"Partly cloudy":"Night cloudy";
  if(code===3)return"Overcast";
  if(code===45||code===48)return"Fog";
  if(code>=51&&code<=55)return"Drizzle";
  if(code===56||code===57)return"Freezing drizzle";
  if(code===61)return"Light rain";if(code===63)return"Rain";if(code===65)return"Heavy rain";
  if(code===66||code===67)return"Freezing rain";
  if(code>=71&&code<=77)return"Snow";
  if(code>=80&&code<=82)return"Showers";
  if(code===85||code===86)return"Snow showers";
  if(code===95)return"Thunderstorm";
  if(code===96||code===99)return"Thunderstorm with hail";
  return"Weather update";
}

/* ───── PARSERS ───── */
function parseTomorrowCurrent(tmData){
  var vals={cloudCover:null,dewPoint:null};
  if(tmData&&tmData.data&&tmData.data.timelines&&tmData.data.timelines.length){
    var intervals=tmData.data.timelines[0].intervals||[];
    if(intervals.length&&intervals[0].values){
      vals.cloudCover=intervals[0].values.cloudCover;
      vals.dewPoint=intervals[0].values.dewPoint;
    }
  }
  return vals;
}
function parseOpenMeteoCurrent(omData){
  var vals={apparent_temperature:null};
  if(omData&&omData.current&&omData.current.apparent_temperature!=null){
    vals.apparent_temperature=omData.current.apparent_temperature;
  }
  return vals;
}
function parseCheckWXCeiling(cwx){
  if(!cwx||!cwx.data||!cwx.data.length)return null;
  var metar=cwx.data[0];if(!metar)return null;
  if(metar.ceiling&&metar.ceiling.feet!=null)return metar.ceiling.feet;
  if(metar.clouds&&Array.isArray(metar.clouds)&&metar.clouds.length){
    var fallbackFeet=null;
    for(var i=0;i<metar.clouds.length;i++){
      var cl=metar.clouds[i];
      var code=String(cl.code||cl.type||"").toUpperCase();
      var baseFeet=first(cl.base_feet_agl,cl.base_feet,cl.altitude_feet,cl.altitude,cl.feet);
      if((code==="BKN"||code==="OVC"||code==="VV")&&baseFeet!=null)return Number(baseFeet);
      if(fallbackFeet==null&&baseFeet!=null)fallbackFeet=Number(baseFeet);
    }
    return fallbackFeet;
  }
  return null;
}
function parseAccuPollen(accuData){
  if(!accuData||!accuData.DailyForecasts||!accuData.DailyForecasts.length)return null;
  var day=accuData.DailyForecasts[0];
  if(!day.AirAndPollen||!day.AirAndPollen.length)return null;
  var pollenValues=[];
  for(var i=0;i<day.AirAndPollen.length;i++){
    var ap=day.AirAndPollen[i];
    var name=String(ap.Name||"").toLowerCase();
    if(name.indexOf("tree")>=0||name.indexOf("grass")>=0||name.indexOf("ragweed")>=0||name.indexOf("mold")>=0){
      if(ap.Value!=null&&!isNaN(ap.Value))pollenValues.push(Number(ap.Value));
    }
  }
  if(!pollenValues.length)return null;
  return roundVal(avg(pollenValues));
}
function getCapeFactor(cape){
  if(cape==null||isNaN(cape))return 0;
  if(cape<100)return 5;if(cape<250)return 15;if(cape<500)return 30;
  if(cape<1000)return 50;if(cape<2000)return 70;return 90;
}
function computeStormProbability(precipProb,cloudCover,cape){
  var p=first(precipProb,0),c=first(cloudCover,0),capeVal=first(cape,0);
  if(p<30)return 0;
  return roundVal(Math.min(100,(p*0.6)+(c*0.1)+(getCapeFactor(capeVal)*0.3)));
}

/* ───── HOURLY ───── */
function buildHourlyFromPirate(prData,currentTemp,currentWeatherCode,tz){
  var out={time:[],temperature_2m:[],weather_code:[],is_day:[]};
  if(!prData||!prData.hourly||!prData.hourly.data||!prData.hourly.data.length)return out;
  var added=0;
  for(var i=0;i<prData.hourly.data.length&&added<24;i++){
    var h=prData.hourly.data[i];
    var localISO=epochToLocalISO(h.time,tz);
    var localHour=getLocalHour(h.time,tz);
    var isDay=(localHour>=6&&localHour<20)?1:0;
    if(i===0){
      out.time.push(localISO);
      out.temperature_2m.push(currentTemp!=null?roundVal(currentTemp):roundVal(h.temperature));
      out.weather_code.push(currentWeatherCode!=null?currentWeatherCode:pirateToWMO(h.icon));
      out.is_day.push(isDay);
    } else {
      out.time.push(localISO);
      out.temperature_2m.push(roundVal(h.temperature));
      out.weather_code.push(pirateToWMO(h.icon));
      out.is_day.push(isDay);
    }
    added++;
  }
  return out;
}

/* ───── TIME PERIODS ───── */
function buildTimePeriodsFromPirate(prData,tz){
  var periods=[
    {name:"Morning",startH:6,endH:12},{name:"Afternoon",startH:12,endH:17},
    {name:"Evening",startH:17,endH:21},{name:"Overnight",startH:21,endH:30}
  ];
  if(!prData||!prData.hourly||!prData.hourly.data){
    return periods.map(function(p){return{name:p.name,temp:null,weather_code:0,precip_chance:null,has_data:false};});
  }
  var nowEpoch=Math.floor(Date.now()/1000);
  var todayLocal=epochToLocalISO(nowEpoch,tz).substring(0,10);
  var nowLocalHour=getLocalHour(nowEpoch,tz);
  var tmrwDate=epochToLocalISO(nowEpoch+86400,tz).substring(0,10);
  var allHours=prData.hourly.data.map(function(h){
    return{localDate:epochToLocalISO(h.time,tz).substring(0,10),localHour:getLocalHour(h.time,tz),
      temp:roundVal(h.temperature),code:pirateToWMO(h.icon),
      precip:h.precipProbability!=null?Math.round(h.precipProbability*100):null};
  });
  return periods.map(function(per){
    var temps=[],codes={},precips=[];
    allHours.forEach(function(ah){
      var inPeriod=false;
      if(per.name==="Overnight"){
        if((ah.localDate===todayLocal&&ah.localHour>=21)||(ah.localDate===tmrwDate&&ah.localHour<6))inPeriod=true;
      } else {
        var targetDate=todayLocal;
        if(per.endH<=nowLocalHour)targetDate=tmrwDate;
        if(ah.localDate===targetDate&&ah.localHour>=per.startH&&ah.localHour<per.endH)inPeriod=true;
      }
      if(inPeriod){
        if(ah.temp!=null)temps.push(ah.temp);
        if(ah.code!=null)codes[ah.code]=(codes[ah.code]||0)+1;
        if(ah.precip!=null)precips.push(ah.precip);
      }
    });
    var avgTemp=temps.length?Math.round(temps.reduce(function(a,b){return a+b;},0)/temps.length):null;
    var avgPrecip=precips.length?Math.round(precips.reduce(function(a,b){return a+b;},0)/precips.length):null;
    var dominantCode=0,maxCount=0;
    Object.keys(codes).forEach(function(k){if(codes[k]>maxCount){maxCount=codes[k];dominantCode=Number(k);}});
    return{name:per.name,temp:avgTemp,weather_code:dominantCode,precip_chance:avgPrecip,has_data:temps.length>0};
  });
}

/* ───── DAILY 7 DAYS ───── */
function buildDaily(accuData,prData){
  var out=[];
  if(accuData&&accuData.DailyForecasts){
    var list=accuData.DailyForecasts;
    var count=Math.min(5,list.length);
    for(var i=0;i<count;i++){
      var d=list[i];
      var dateStr=d.Date?new Date(d.Date).toISOString().split("T")[0]:null;
      var uvVal=null;
      if(d.AirAndPollen&&d.AirAndPollen.length){
        for(var p=0;p<d.AirAndPollen.length;p++){
          if(d.AirAndPollen[p].Name==="UVIndex"){uvVal=d.AirAndPollen[p].Value;break;}
        }
      }
      out.push({
        date:dateStr,
        weather_code:accuPhraseToWMO(d.Day&&d.Day.IconPhrase?d.Day.IconPhrase:d.Night&&d.Night.IconPhrase?d.Night.IconPhrase:""),
        max_temp:d.Temperature&&d.Temperature.Maximum?d.Temperature.Maximum.Value:null,
        min_temp:d.Temperature&&d.Temperature.Minimum?d.Temperature.Minimum.Value:null,
        precip_chance:d.Day&&d.Day.PrecipitationProbability!=null?d.Day.PrecipitationProbability:null,
        sunrise:d.Sun&&d.Sun.Rise?new Date(d.Sun.Rise).toISOString().substring(0,19):null,
        sunset:d.Sun&&d.Sun.Set?new Date(d.Sun.Set).toISOString().substring(0,19):null,
        uv:uvVal
      });
    }
  }
  if(prData&&prData.daily&&prData.daily.data){
    for(var idx=5;idx<7;idx++){
      var pd=prData.daily.data[idx];
      if(!pd)continue;
      out.push({
        date:epochToLocalISO(pd.time,"UTC").substring(0,10),
        weather_code:pirateToWMO(pd.icon),
        max_temp:pd.temperatureHigh!=null?pd.temperatureHigh:null,
        min_temp:pd.temperatureLow!=null?pd.temperatureLow:null,
        precip_chance:pd.precipProbability!=null?Math.round(pd.precipProbability*100):null,
        sunrise:pd.sunriseTime?epochToLocalISO(pd.sunriseTime,"UTC").substring(0,19):null,
        sunset:pd.sunsetTime?epochToLocalISO(pd.sunsetTime,"UTC").substring(0,19):null,
        uv:pd.uvIndex!=null?pd.uvIndex:null
      });
    }
  }
  return out;
}

/* ───── MONTHLY ───── */
async function fetchAndBuildMonthly(loc,dailyArray){
  var today=new Date();
  var monthKey=makeCK(loc.lat,loc.lon)+"|"+today.getFullYear()+"-"+(today.getMonth()+1);
  var omMonthlyData=getCached(monthlyCache,monthKey,MONTHLY_CACHE_MS);
  if(!omMonthlyData){
    var firstOfMonth=new Date(today.getFullYear(),today.getMonth(),1).toISOString().split("T")[0];
    var todayStr=today.toISOString().split("T")[0];
    if(firstOfMonth!==todayStr){
      omMonthlyData=await sf(
        "https://archive-api.open-meteo.com/v1/archive?latitude="+loc.lat+"&longitude="+loc.lon+
        "&start_date="+firstOfMonth+"&end_date="+todayStr+
        "&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto","OMMonthly"
      );
      if(omMonthlyData)setCached(monthlyCache,monthKey,omMonthlyData);
    }
  }
  var map={};
  if(omMonthlyData&&omMonthlyData.daily&&omMonthlyData.daily.time){
    var d=omMonthlyData.daily;
    for(var i=0;i<d.time.length;i++){
      map[d.time[i]]={date:d.time[i],weather_code:d.weather_code?d.weather_code[i]:0,
        max_temp:d.temperature_2m_max?d.temperature_2m_max[i]:null,
        min_temp:d.temperature_2m_min?d.temperature_2m_min[i]:null};
    }
  }
  for(var j=0;j<dailyArray.length;j++){
    var dy=dailyArray[j];if(!dy.date)continue;
    map[dy.date]={date:dy.date,weather_code:dy.weather_code,max_temp:dy.max_temp,min_temp:dy.min_temp};
  }
  return Object.values(map).sort(function(a,b){return new Date(a.date)-new Date(b.date);});
}

/* ───── RECOMMENDATIONS (Gemini) ───── */
async function buildRecommendations(payload){
  var cacheKey=(payload.locationName||"")+(payload.conditionText||"")+(payload.currentTemp||"");
  var cached=getCached(recommendationsCache,cacheKey,RECOMMENDATIONS_CACHE_MS);
  if(cached)return cached;
  try{
    var prompt="You are a friendly weather assistant. Write 6-8 short natural recommendations for someone planning their day. Each is one sentence. Be specific, warm, practical. Vary tones. Return ONLY a JSON array of strings.\n\nWeather:\n- Location: "+(payload.locationName||"Unknown")+"\n- Temp: "+(payload.currentTemp!=null?payload.currentTemp+"°C":"Unknown")+"\n- Feels: "+(payload.realFeel!=null?payload.realFeel+"°C":"Unknown")+"\n- Condition: "+(payload.conditionText||"Unknown")+"\n- Humidity: "+(payload.humidity!=null?payload.humidity+"%":"Unknown")+"\n- Wind: "+(payload.wind!=null?payload.wind+" km/h":"Unknown")+"\n- Rain: "+(payload.rainChance!=null?payload.rainChance+"%":"Unknown")+"\n- UV: "+(payload.uv!=null?payload.uv:"Unknown")+"\n- AQI: "+(payload.aqi!=null?payload.aqi:"Unknown")+"\n- Sunset: "+(payload.sunsetText||"Unknown");
    var resp=await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key="+GEMINI_KEY,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.8,maxOutputTokens:1024}})});
    if(!resp.ok)throw new Error("Gemini HTTP "+resp.status);
    var data=await resp.json();
    var text=data.candidates&&data.candidates[0]&&data.candidates[0].content&&data.candidates[0].content.parts&&data.candidates[0].content.parts[0]?data.candidates[0].content.parts[0].text:"";
    text=text.replace(/```json|```/g,"").trim();
    var parsed=JSON.parse(text);
    if(Array.isArray(parsed)&&Array.isArray(parsed[0]))parsed=parsed[0];
    parsed=parsed.map(function(r){return typeof r==="string"?r:(r.text||r.recommendation||r.message||JSON.stringify(r));});
    if(parsed.length){var result=parsed.slice(0,8);setCached(recommendationsCache,cacheKey,result);return result;}
  }catch(e){console.log("Gemini ERR:",e.message);}
  return buildRecommendationsFallback(payload);
}
function buildRecommendationsFallback(payload){
  var recs=[],temp=payload.currentTemp,rain=payload.rainChance,uv=payload.uv,aqi=payload.aqi,wind=payload.wind,thunder=payload.thunderProbability,humidity=payload.humidity,visibility=payload.visibilityKm;
  if(temp!=null){
    if(temp>=35)recs.push("It's extremely hot — avoid long exposure and stay hydrated.");
    else if(temp>=30)recs.push("A warm day ahead — light clothing and water will help.");
    else if(temp<=12)recs.push("It's fairly cool — a light jacket may feel comfortable.");
    else recs.push("The temperature feels comfortable for most outdoor activity.");
  }
  if(rain!=null&&rain>=70)recs.push("Rain is likely — carrying an umbrella is a good idea.");
  else if(rain!=null&&rain>=40)recs.push("There's a fair chance of rain, so keep backup plans ready.");
  if(uv!=null&&uv>=8)recs.push("UV is very strong — sunscreen and shade are strongly recommended.");
  else if(uv!=null&&uv>=5)recs.push("UV is moderate — consider sunscreen for extended outdoor time.");
  if(aqi!=null&&aqi>150)recs.push("Air quality is poor — reduce long outdoor exposure if possible.");
  if(wind!=null&&wind>=30)recs.push("It's fairly windy — secure light items and expect breezy conditions.");
  if(!recs.length)recs.push("Weather looks fairly stable right now — enjoy your day!");
  return recs;
}

/* ───── LOCATION RESOLUTION ───── */
async function resolveIp(){
  try{
    var r=await sf("https://ipapi.co/json/","IP-resolve");
    if(r&&r.latitude&&r.longitude)return{lat:r.latitude,lon:r.longitude,name:r.city||"Unknown",region:r.region||"",country:r.country_name||"",key:null};
  }catch(e){}
  return{lat:51.5074,lon:-0.1278,name:"London",region:"England",country:"United Kingdom",key:null};
}
async function resolveLoc(query){
  if(query.lat!=null&&query.lon!=null){
    var lat=parseFloat(query.lat),lon=parseFloat(query.lon);
    try{
      var r=await sf("https://api.weatherapi.com/v1/search.json?key="+WEATHERAPI_KEY+"&q="+lat+","+lon,"ResolveLoc-coords");
      if(r&&r.length)return{lat:lat,lon:lon,name:r[0].name||"",region:r[0].region||"",country:r[0].country||"",key:null};
    }catch(e){}
    return{lat:lat,lon:lon,name:"",region:"",country:"",key:null};
  }
  if(query.city){
    try{
      var results=await sf("https://api.weatherapi.com/v1/search.json?key="+WEATHERAPI_KEY+"&q="+encodeURIComponent(query.city),"ResolveLoc-city");
      if(results&&results.length)return{lat:results[0].lat,lon:results[0].lon,name:results[0].name||query.city,region:results[0].region||"",country:results[0].country||"",key:null};
    }catch(e){}
    return{lat:51.5074,lon:-0.1278,name:query.city,region:"",country:"",key:null};
  }
  return resolveIp();
}

/* ───── FETCHERS ───── */
function fetchWeatherApi(loc){
  return sf("https://api.weatherapi.com/v1/forecast.json?key="+WEATHERAPI_KEY+"&q="+loc.lat+","+loc.lon+"&days=3&aqi=yes","WeatherAPI");
}
function fetchTomorrowCurrent(loc){
  return sf("https://api.tomorrow.io/v4/timelines?location="+loc.lat+","+loc.lon+"&fields=cloudCover,dewPoint&timesteps=current&units=metric&apikey="+TOMORROW_KEY,"Tomorrow");
}
function fetchPirate(loc){
  return sf("https://api.pirateweather.net/forecast/"+PIRATE_KEY+"/"+loc.lat+","+loc.lon+"?units=si&extend=hourly","Pirate");
}
function fetchOpenMeteoCurrent(loc){
  var cacheKey=makeCK(loc.lat,loc.lon);
  var cached=getCached(openMeteoCurrentCache,cacheKey,OPENMETEO_CURRENT_CACHE_MS);
  if(cached){console.log("OM current cache hit:",cacheKey);return Promise.resolve(cached);}
  return sf("https://api.open-meteo.com/v1/forecast?latitude="+loc.lat+"&longitude="+loc.lon+"&current=apparent_temperature&timezone=auto","OpenMeteoCurrent")
    .then(function(data){if(data)setCached(openMeteoCurrentCache,cacheKey,data);return data;});
}
async function fetchAccuForecast(loc){
  try{
    var locKey=makeCK(loc.lat,loc.lon);
    var cachedKey=getCached(accuLocationCache,locKey,ACCU_LOCATION_CACHE_MS);
    if(!cachedKey){
      var locData=await sf("http://dataservice.accuweather.com/locations/v1/cities/geoposition/search?apikey="+ACCUWEATHER_API_KEY+"&q="+loc.lat+","+loc.lon,"AccuLocation");
      if(locData&&locData.Key){cachedKey=locData.Key;setCached(accuLocationCache,locKey,cachedKey);}
    }
    if(!cachedKey)return null;
    var cachedForecast=getCached(accuForecastCache,cachedKey,ACCU_FORECAST_CACHE_MS);
    if(cachedForecast)return cachedForecast;
    var forecast=await sf("http://dataservice.accuweather.com/forecasts/v1/daily/5day/"+cachedKey+"?apikey="+ACCUWEATHER_API_KEY+"&details=true&metric=true","AccuForecast");
    if(forecast)setCached(accuForecastCache,cachedKey,forecast);
    return forecast;
  }catch(e){console.log("AccuWeather ERR:",e.message);return null;}
}
function fetchCheckWX(loc){
  return fetch("https://api.checkwx.com/metar/lat/"+loc.lat+"/lon/"+loc.lon+"/decoded",{headers:{"X-API-Key":CHECKWX_API_KEY}})
    .then(function(r){
      if(!r.ok){return r.text().then(function(t){console.log("CheckWX HTTP "+r.status+": "+t.substring(0,300));return null;});}
      return r.json();
    }).catch(function(e){console.log("CheckWX ERR:",e.message);return null;});
}
function buildAQ(waData){
  try{if(waData&&waData.current&&waData.current.air_quality&&waData.current.air_quality.pm2_5!=null)return waData.current.air_quality.pm2_5;}catch(e){}
  return null;
}

/* ═══════════════════════════════════════════════════
   AI CHAT SYSTEM
═══════════════════════════════════════════════════ */

/* ── Web Search (Tavily + Exa) ── */
async function tavilySearch(query) {
  try {
    var resp = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: TAVILY_KEY,
        query: query,
        search_depth: "advanced",
        max_results: 5,
        include_answer: true,
        include_raw_content: false
      })
    });
    if (!resp.ok) throw new Error("Tavily HTTP " + resp.status);
    var data = await resp.json();
    var results = [];
    if (data.answer) results.push({ title: "Summary", content: data.answer, url: "" });
    (data.results || []).forEach(function(r) {
      results.push({ title: r.title || "", content: r.content || "", url: r.url || "" });
    });
    return results;
  } catch(e) {
    console.log("Tavily ERR:", e.message);
    return null;
  }
}

async function exaSearch(query) {
  try {
    var resp = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": EXA_KEY },
      body: JSON.stringify({
        query: query,
        numResults: 4,
        useAutoprompt: true,
        contents: { text: { maxCharacters: 800 } }
      })
    });
    if (!resp.ok) throw new Error("Exa HTTP " + resp.status);
    var data = await resp.json();
    return (data.results || []).map(function(r) {
      return { title: r.title || "", content: (r.text || "").substring(0, 800), url: r.url || "" };
    });
  } catch(e) {
    console.log("Exa ERR:", e.message);
    return null;
  }
}

async function webSearch(query) {
  console.log("Web search:", query);
  // Try Tavily first, fall back to Exa
  var results = await tavilySearch(query);
  if (!results || !results.length) results = await exaSearch(query);
  return results || [];
}

function formatSearchResults(results) {
  if (!results || !results.length) return "No search results found.";
  return results.map(function(r, i) {
    return "Source " + (i+1) + ": " + r.title + "\n" + r.content + (r.url ? "\nURL: " + r.url : "");
  }).join("\n\n---\n\n");
}

/* ── Should we search the web? ── */
function needsWebSearch(message) {
  var msg = message.toLowerCase();
  var searchTriggers = [
    "latest","recent","current","today","now","news","update","happening",
    "2024","2025","2026","price","stock","score","result","win","who is",
    "what is","how to","when did","where is","weather in","forecast for",
    "temperature in"
  ];
  return searchTriggers.some(function(t) { return msg.indexOf(t) >= 0; });
}

/* ── LLM Providers ── */
async function callGroq(messages, systemPrompt) {
  var msgs = [{ role: "system", content: systemPrompt }].concat(messages);
  var resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + GROQ_KEY },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: msgs,
      max_tokens: 1024,
      temperature: 0.7
    })
  });
  if (!resp.ok) {
    var t = await resp.text();
    throw new Error("Groq HTTP " + resp.status + ": " + t.substring(0, 200));
  }
  var data = await resp.json();
  return data.choices[0].message.content;
}

async function callCerebras(messages, systemPrompt) {
  var msgs = [{ role: "system", content: systemPrompt }].concat(messages);
  var resp = await fetch("https://api.cerebras.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + CEREBRAS_KEY },
    body: JSON.stringify({
      model: "llama-3.3-70b",
      messages: msgs,
      max_tokens: 1024,
      temperature: 0.7
    })
  });
  if (!resp.ok) {
    var t = await resp.text();
    throw new Error("Cerebras HTTP " + resp.status + ": " + t.substring(0, 200));
  }
  var data = await resp.json();
  return data.choices[0].message.content;
}

async function callAPIFreeLLM(messages, systemPrompt) {
  var msgs = [{ role: "system", content: systemPrompt }].concat(messages);
  var resp = await fetch("https://api.apifree.llm/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + APIFREELLM_KEY },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: msgs,
      max_tokens: 1024,
      temperature: 0.7
    })
  });
  if (!resp.ok) {
    var t = await resp.text();
    throw new Error("APIFreeLLM HTTP " + resp.status + ": " + t.substring(0, 200));
  }
  var data = await resp.json();
  return data.choices[0].message.content;
}

async function callLLM(messages, systemPrompt) {
  // Try Groq first, then Cerebras, then APIFreeLLM
  var errors = [];

  try {
    console.log("Trying Groq...");
    var result = await callGroq(messages, systemPrompt);
    console.log("Groq OK");
    return { text: result, provider: "Groq" };
  } catch(e) {
    console.log("Groq failed:", e.message);
    errors.push("Groq: " + e.message);
  }

  try {
    console.log("Trying Cerebras...");
    var result = await callCerebras(messages, systemPrompt);
    console.log("Cerebras OK");
    return { text: result, provider: "Cerebras" };
  } catch(e) {
    console.log("Cerebras failed:", e.message);
    errors.push("Cerebras: " + e.message);
  }

  try {
    console.log("Trying APIFreeLLM...");
    var result = await callAPIFreeLLM(messages, systemPrompt);
    console.log("APIFreeLLM OK");
    return { text: result, provider: "APIFreeLLM" };
  } catch(e) {
    console.log("APIFreeLLM failed:", e.message);
    errors.push("APIFreeLLM: " + e.message);
  }

  throw new Error("All AI providers failed: " + errors.join("; "));
}

/* ── /api/chat endpoint ── */
app.post("/api/chat", async function(req, res) {
  try {
    var messages = req.body.messages || [];
    var weatherContext = req.body.weatherContext || null;
    var locationName = req.body.locationName || "Unknown location";

    if (!messages.length) {
      return res.status(400).json({ error: "No messages provided" });
    }

    var lastUserMessage = "";
    for (var i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") { lastUserMessage = messages[i].content; break; }
    }

    // Decide if we need web search
    var searchResults = null;
    var searchQuery = null;
    var didSearch = false;

    if (needsWebSearch(lastUserMessage)) {
      searchQuery = lastUserMessage;
      // If it's a weather question, append location
      if (/weather|forecast|rain|temperature|humidity|wind/i.test(lastUserMessage) && locationName) {
        if (lastUserMessage.toLowerCase().indexOf(locationName.toLowerCase()) === -1) {
          searchQuery = lastUserMessage + " " + locationName;
        }
      }
      searchResults = await webSearch(searchQuery);
      didSearch = true;
      console.log("Searched for:", searchQuery, "- got", searchResults.length, "results");
    }

    // Build system prompt
    var now = new Date();
    var systemPrompt = "You are RealWeather AI, a smart, friendly weather and general assistant embedded in the RealWeather app. " +
      "You can answer weather questions, help plan activities around weather, and answer general knowledge questions. " +
      "Be conversational, helpful, and concise. Use markdown for formatting when helpful (bold, lists, etc). " +
      "Today is " + now.toDateString() + ". " +
      "The user's current location is " + locationName + ". ";

    if (weatherContext) {
      systemPrompt += "\n\nCurrent weather at " + locationName + ":\n" +
        "- Temperature: " + (weatherContext.temp != null ? weatherContext.temp + "°C" : "Unknown") + "\n" +
        "- Feels like: " + (weatherContext.feelsLike != null ? weatherContext.feelsLike + "°C" : "Unknown") + "\n" +
        "- Condition: " + (weatherContext.condition || "Unknown") + "\n" +
        "- Humidity: " + (weatherContext.humidity != null ? weatherContext.humidity + "%" : "Unknown") + "\n" +
        "- Wind: " + (weatherContext.wind != null ? weatherContext.wind + " km/h" : "Unknown") + "\n" +
        "- UV Index: " + (weatherContext.uv != null ? weatherContext.uv : "Unknown") + "\n" +
        "- Rain chance: " + (weatherContext.rainChance != null ? weatherContext.rainChance + "%" : "Unknown") + "\n" +
        "- AQI: " + (weatherContext.aqi != null ? weatherContext.aqi : "Unknown");
    }

    if (searchResults && searchResults.length) {
      systemPrompt += "\n\nWeb search results for \"" + searchQuery + "\":\n\n" + formatSearchResults(searchResults) +
        "\n\nUse these results to inform your answer. Cite sources when relevant.";
    }

    var llmResult = await callLLM(messages, systemPrompt);

    res.json({
      reply: llmResult.text,
      provider: llmResult.provider,
      searched: didSearch,
      searchQuery: searchQuery || null,
      searchResultCount: searchResults ? searchResults.length : 0
    });

  } catch(e) {
    console.log("Chat ERR:", e.message);
    res.status(500).json({ error: e.message || "Chat failed" });
  }
});

/* ── /api/search-ai endpoint (standalone web search) ── */
app.post("/api/search-ai", async function(req, res) {
  try {
    var query = (req.body.query || "").trim();
    if (!query) return res.status(400).json({ error: "No query" });
    var results = await webSearch(query);
    res.json({ results: results, query: query });
  } catch(e) {
    console.log("Search-AI ERR:", e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ───── MAIN WEATHER ROUTE ───── */
app.get("/api/weather", async function(req,res){
  try{
    var loc;
    if(req.query.lat!=null||req.query.lon!=null||req.query.city){loc=await resolveLoc(req.query);}
    else{loc=await resolveIp();}
    var cKey=makeCK(loc.lat,loc.lon);
    var cached=getC(cKey);
    if(cached){
      console.log("Cache hit:",loc.name);
      if(loc.name&&loc.name!==""&&loc.name!=="Unknown location"){cached.location.name=loc.name;cached.location.region=loc.region;cached.location.country=loc.country;}
      return res.json(cached);
    }
    console.log("\n=== Fetching for:",loc.name,loc.lat,loc.lon,"===");
    var results=await Promise.all([fetchWeatherApi(loc),fetchTomorrowCurrent(loc),fetchPirate(loc),fetchAccuForecast(loc),fetchCheckWX(loc),fetchOpenMeteoCurrent(loc)]);
    var waData=results[0],tmData=results[1],prData=results[2],accuData=results[3],checkwxData=results[4],omCurrentData=results[5];
    if(!waData)return res.status(503).json({error:"Primary weather API unavailable"});
    var waCurr=waData.current||{},waLoc=waData.location||{},tz=waLoc.tz_id||"UTC";
    var tmCurrent=parseTomorrowCurrent(tmData);
    var omCurrent=parseOpenMeteoCurrent(omCurrentData);
    var checkwxCeilingFeet=parseCheckWXCeiling(checkwxData);
    var accuPollen=parseAccuPollen(accuData);
    var pirCurr=prData&&prData.currently?prData.currently:{};
    var currentTemp=first(pirCurr.temperature,waCurr.temp_c);
    var weatherCode=first(pirateToWMO(pirCurr.icon),waCodeToWMO(waCurr.condition?waCurr.condition.code:null));
    var currentIsDay=first(waCurr.is_day,getIsDayNow(tz));
    var conditionText=getWeatherText(weatherCode,currentIsDay);
    var feelsLikeTemp=first(omCurrent.apparent_temperature,waCurr.feelslike_c);
    var hourly=buildHourlyFromPirate(prData,currentTemp,weatherCode,tz);
    var timePeriods=buildTimePeriodsFromPirate(prData,tz);
    var dailyArray=buildDaily(accuData,prData);
    var monthly=await fetchAndBuildMonthly(loc,dailyArray);
    var pm25=buildAQ(waData);
    var rainChance=null;
    if(prData&&prData.currently&&prData.currently.precipProbability!=null)rainChance=Math.round(prData.currently.precipProbability*100);
    if(rainChance==null&&dailyArray.length)rainChance=dailyArray[0].precip_chance;
    var stormProbability=computeStormProbability(rainChance,tmCurrent.cloudCover,null);
    var skyMetrics={realfeel_shade:feelsLikeTemp!=null?roundVal(feelsLikeTemp-3):null,cloud_cover:roundVal(tmCurrent.cloudCover),cloud_base:checkwxCeilingFeet!=null?roundVal(checkwxCeilingFeet/3280.84):null,thunder_probability:stormProbability,dew_point:roundVal(tmCurrent.dewPoint),pollen_count:roundVal(accuPollen)};
    var dTime=[],dCode=[],dMax=[],dMin=[],dPrecip=[],dSunrise=[],dSunset=[],dUv=[];
    for(var i=0;i<dailyArray.length;i++){var dy=dailyArray[i];dTime.push(dy.date);dCode.push(dy.weather_code);dMax.push(dy.max_temp);dMin.push(dy.min_temp);dPrecip.push(dy.precip_chance);dSunrise.push(dy.sunrise);dSunset.push(dy.sunset);dUv.push(dy.uv);}
    if(waData.forecast&&waData.forecast.forecastday&&waData.forecast.forecastday.length){
      var wf=waData.forecast.forecastday;
      if(wf[0]&&wf[0].astro){dSunrise[0]=wf[0].date+"T"+c12to24(wf[0].astro.sunrise);dSunset[0]=wf[0].date+"T"+c12to24(wf[0].astro.sunset);}
      if(wf[1]&&wf[1].astro){dSunrise[1]=wf[1].date+"T"+c12to24(wf[1].astro.sunrise);dSunset[1]=wf[1].date+"T"+c12to24(wf[1].astro.sunset);}
    }
    var recommendations=await buildRecommendations({locationName:loc.name,conditionText:conditionText,currentTemp:roundVal(currentTemp),realFeel:roundVal(feelsLikeTemp),rainChance:rainChance,uv:waCurr.uv,aqi:pm25,humidity:waCurr.humidity,wind:waCurr.wind_kph,visibilityKm:waCurr.vis_km,thunderProbability:stormProbability,cloudCover:tmCurrent.cloudCover,dewPoint:tmCurrent.dewPoint,sunsetText:dSunset[0]?dSunset[0].substring(11,16):null});
    var result={timezone:tz,location:{key:loc.key,name:loc.name||waLoc.name||"Unknown",region:loc.region||waLoc.region||"",country:loc.country||waLoc.country||"",latitude:loc.lat,longitude:loc.lon,timezone:tz},current:{temperature_c:roundVal(currentTemp),weather_code:weatherCode,condition_text:conditionText,is_day:currentIsDay,feelslike_c:roundVal(feelsLikeTemp),humidity:waCurr.humidity,wind_kph:waCurr.wind_kph,wind_degree:waCurr.wind_degree,pressure_hpa:waCurr.pressure_mb,visibility:waCurr.vis_km!=null?waCurr.vis_km*1000:null,rain_chance:rainChance,uv:waCurr.uv,air_quality_pm25:pm25},sky_metrics:skyMetrics,recommendations:recommendations,time_periods:timePeriods,hourly:hourly,daily:{time:dTime,weather_code:dCode,temperature_2m_max:dMax,temperature_2m_min:dMin,precipitation_probability_max:dPrecip,sunrise:dSunrise,sunset:dSunset,uv_index_max:dUv},monthly:monthly};
    putC(cKey,result);
    res.json(result);
  }catch(e){console.log("ERROR:",e);res.status(500).json({error:"Failed"});}
});

/* ───── SEARCH ───── */
app.get("/api/search",async function(req,res){
  try{
    var q=(req.query.q||"").trim();
    if(!q)return res.json({results:[]});
    var wa=await sf("https://api.weatherapi.com/v1/search.json?key="+WEATHERAPI_KEY+"&q="+encodeURIComponent(q),"Search");
    if(wa&&wa.length){return res.json({results:wa.map(function(i){return{name:i.name||"",region:i.region||"",country:i.country||"",latitude:i.lat,longitude:i.lon};})});}
    res.json({results:[]});
  }catch(e){console.log("SEARCH ERR:",e);res.status(500).json({results:[]});}
});

app.get("/",function(req,res){res.send("RealWeather backend running");});
var PORT=process.env.PORT||3000;
app.listen(PORT,function(){console.log("Server on http://localhost:"+PORT);});
