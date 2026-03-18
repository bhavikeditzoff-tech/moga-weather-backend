require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const WEATHERAPI_KEY = process.env.WEATHERAPI_KEY;

const LOCATIONS = {
  moga: {
    key: "moga",
    name: "Moga",
    region: "Punjab",
    country: "India",
    lat: 30.8165,
    lon: 75.1717
  },
  ludhiana: {
    key: "ludhiana",
    name: "Ludhiana",
    region: "Punjab",
    country: "India",
    lat: 30.9000,
    lon: 75.8573
  }
};

function firstAvailable(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return null;
}

function mapWeatherApiConditionToCode(text) {
  const lower = (text || "").toLowerCase();

  if (lower.includes("sunny") || lower.includes("clear")) return 0;
  if (lower.includes("partly cloudy")) return 2;
  if (lower.includes("cloudy")) return 3;
  if (lower.includes("overcast")) return 3;
  if (lower.includes("fog") || lower.includes("mist")) return 45;
  if (lower.includes("drizzle")) return 53;
  if (lower.includes("rain")) return 63;
  if (lower.includes("shower")) return 80;
  if (lower.includes("thunder")) return 95;
  if (lower.includes("snow")) return 73;

  return 0;
}

function convert12hTo24h(time12h) {
  if (!time12h) return "00:00:00";

  const [time, modifier] = time12h.split(" ");
  let [hours, minutes] = time.split(":");

  if (hours === "12") {
    hours = "00";
  }

  if (modifier === "PM") {
    hours = String(parseInt(hours, 10) + 12);
  }

  return `${hours.padStart(2, "0")}:${minutes}:00`;
}

function buildDailyFromWeatherApi(weatherApiData) {
  const forecastDays = weatherApiData.forecast?.forecastday || [];

  return {
    time: forecastDays.map(day => day.date),
    weather_code: forecastDays.map(day => mapWeatherApiConditionToCode(day.day?.condition?.text)),
    temperature_2m_max: forecastDays.map(day => day.day?.maxtemp_c),
    temperature_2m_min: forecastDays.map(day => day.day?.mintemp_c),
    precipitation_probability_max: forecastDays.map(day => Number(day.day?.daily_chance_of_rain ?? 0)),
    sunrise: forecastDays.map(day => `${day.date}T${convert12hTo24h(day.astro?.sunrise)}`),
    sunset: forecastDays.map(day => `${day.date}T${convert12hTo24h(day.astro?.sunset)}`),
    uv_index_max: forecastDays.map(day => day.day?.uv ?? 0)
  };
}

function buildHourlyFromWeatherApi(weatherApiData) {
  const forecastDays = weatherApiData.forecast?.forecastday || [];
  const hourly = {
    time: [],
    temperature_2m: [],
    weather_code: [],
    is_day: [],
    visibility: [],
    humidity: [],
    wind_kph: []
  };

  forecastDays.forEach(day => {
    const hours = day.hour || [];
    hours.forEach(hour => {
      hourly.time.push(hour.time);
      hourly.temperature_2m.push(hour.temp_c);
      hourly.weather_code.push(mapWeatherApiConditionToCode(hour.condition?.text));
      hourly.is_day.push(hour.is_day);
      hourly.visibility.push((hour.vis_km ?? 0) * 1000);
      hourly.humidity.push(hour.humidity ?? null);
      hourly.wind_kph.push(hour.wind_kph ?? null);
    });
  });

  return hourly;
}

app.get("/", (req, res) => {
  res.send("Moga weather backend is running");
});

app.get("/api/weather", async (req, res) => {
  try {
    const requestedCity = (req.query.city || "moga").toLowerCase();
    const location = LOCATIONS[requestedCity] || LOCATIONS.moga;

    const openMeteoWeatherUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}&current=temperature_2m,wind_speed_10m,wind_direction_10m,weather_code,is_day,relative_humidity_2m,apparent_temperature,surface_pressure&hourly=temperature_2m,weather_code,is_day,visibility,relative_humidity_2m,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max&timezone=auto&forecast_days=7`;

    const openMeteoAirUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${location.lat}&longitude=${location.lon}&hourly=pm2_5&timezone=auto`;

    const weatherApiUrl =
      `https://api.weatherapi.com/v1/forecast.json?key=${WEATHERAPI_KEY}&q=${location.lat},${location.lon}&days=7&aqi=yes&alerts=no`;

    const [openMeteoWeatherResponse, openMeteoAirResponse, weatherApiResponse] = await Promise.all([
      fetch(openMeteoWeatherUrl),
      fetch(openMeteoAirUrl),
      fetch(weatherApiUrl)
    ]);

    const openMeteoWeather = await openMeteoWeatherResponse.json();
    const openMeteoAir = await openMeteoAirResponse.json();
    const weatherApiData = await weatherApiResponse.json();

    const weatherApiDaily = buildDailyFromWeatherApi(weatherApiData);
    const weatherApiHourly = buildHourlyFromWeatherApi(weatherApiData);

    const openDaily = {
      time: openMeteoWeather.daily?.time || [],
      weather_code: openMeteoWeather.daily?.weather_code || [],
      temperature_2m_max: openMeteoWeather.daily?.temperature_2m_max || [],
      temperature_2m_min: openMeteoWeather.daily?.temperature_2m_min || [],
      precipitation_probability_max: openMeteoWeather.daily?.precipitation_probability_max || [],
      sunrise: openMeteoWeather.daily?.sunrise || [],
      sunset: openMeteoWeather.daily?.sunset || [],
      uv_index_max: openMeteoWeather.daily?.uv_index_max || []
    };

    const mergedDaily = {
      time: openDaily.time.length ? openDaily.time : weatherApiDaily.time,
      weather_code: openDaily.weather_code.length ? openDaily.weather_code : weatherApiDaily.weather_code,
      temperature_2m_max: openDaily.temperature_2m_max.length ? openDaily.temperature_2m_max : weatherApiDaily.temperature_2m_max,
      temperature_2m_min: openDaily.temperature_2m_min.length ? openDaily.temperature_2m_min : weatherApiDaily.temperature_2m_min,
      precipitation_probability_max: openDaily.precipitation_probability_max.length ? openDaily.precipitation_probability_max : weatherApiDaily.precipitation_probability_max,
      sunrise: openDaily.sunrise.length ? openDaily.sunrise : weatherApiDaily.sunrise,
      sunset: openDaily.sunset.length ? openDaily.sunset : weatherApiDaily.sunset,
      uv_index_max: weatherApiDaily.uv_index_max.length ? weatherApiDaily.uv_index_max : openDaily.uv_index_max
    };

    // Prefer WeatherAPI hourly for app-like display feel
    const mergedHourly = weatherApiHourly.time.length ? weatherApiHourly : {
      time: openMeteoWeather.hourly?.time || [],
      temperature_2m: openMeteoWeather.hourly?.temperature_2m || [],
      weather_code: openMeteoWeather.hourly?.weather_code || [],
      is_day: openMeteoWeather.hourly?.is_day || [],
      visibility: openMeteoWeather.hourly?.visibility || [],
      humidity: openMeteoWeather.hourly?.relative_humidity_2m || [],
      wind_kph: openMeteoWeather.hourly?.wind_speed_10m || []
    };

    const nearestHourlyIndex = (() => {
      if (!mergedHourly.time.length) return 0;
      const now = new Date();
      let idx = 0;
      let best = Infinity;

      for (let i = 0; i < mergedHourly.time.length; i++) {
        const t = new Date(mergedHourly.time[i]);
        const diff = Math.abs(now.getTime() - t.getTime());
        if (!isNaN(t.getTime()) && diff < best) {
          best = diff;
          idx = i;
        }
      }
      return idx;
    })();

    const nearestAirIndex = (() => {
      const arr = openMeteoAir.hourly?.time || [];
      if (!arr.length) return 0;
      const now = new Date();
      let idx = 0;
      let best = Infinity;

      for (let i = 0; i < arr.length; i++) {
        const t = new Date(arr[i]);
        const diff = Math.abs(now.getTime() - t.getTime());
        if (!isNaN(t.getTime()) && diff < best) {
          best = diff;
          idx = i;
        }
      }
      return idx;
    })();

    const mergedData = {
      location: {
        key: location.key,
        name: firstAvailable(weatherApiData.location?.name, location.name),
        region: firstAvailable(weatherApiData.location?.region, location.region),
        country: firstAvailable(weatherApiData.location?.country, location.country),
        latitude: firstAvailable(weatherApiData.location?.lat, location.lat),
        longitude: firstAvailable(weatherApiData.location?.lon, location.lon)
      },

      current: {
        // Prefer WeatherAPI for current
        temperature_c: firstAvailable(
          weatherApiData.current?.temp_c,
          openMeteoWeather.current?.temperature_2m
        ),
        feelslike_c: firstAvailable(
          weatherApiData.current?.feelslike_c,
          openMeteoWeather.current?.apparent_temperature
        ),
        humidity: firstAvailable(
          weatherApiData.current?.humidity,
          openMeteoWeather.current?.relative_humidity_2m,
          mergedHourly.humidity?.[nearestHourlyIndex]
        ),
        wind_kph: firstAvailable(
          weatherApiData.current?.wind_kph,
          openMeteoWeather.current?.wind_speed_10m,
          mergedHourly.wind_kph?.[nearestHourlyIndex]
        ),
        wind_degree: firstAvailable(
          weatherApiData.current?.wind_degree,
          openMeteoWeather.current?.wind_direction_10m
        ),
        pressure_hpa: firstAvailable(
          weatherApiData.current?.pressure_mb,
          openMeteoWeather.current?.surface_pressure
        ),
        is_day: firstAvailable(
          weatherApiData.current?.is_day,
          openMeteoWeather.current?.is_day
        ),
        weather_code: firstAvailable(
          openMeteoWeather.current?.weather_code,
          mapWeatherApiConditionToCode(weatherApiData.current?.condition?.text)
        ),
        condition_text: firstAvailable(
          weatherApiData.current?.condition?.text,
          null
        ),
        uv: firstAvailable(
          weatherApiData.current?.uv,
          mergedDaily.uv_index_max?.[0]
        ),
        air_quality_pm25: firstAvailable(
          openMeteoAir.hourly?.pm2_5?.[nearestAirIndex],
          weatherApiData.current?.air_quality?.pm2_5
        )
      },

      daily: mergedDaily,
      hourly: mergedHourly,

      debug: {
        nearestHourlyIndex,
        nearestAirIndex,
        hourlySource: weatherApiHourly.time.length ? "WeatherAPI" : "Open-Meteo",
        currentSourceBias: "WeatherAPI",
        dailySourceBias: "Open-Meteo + WeatherAPI"
      },

      source: {
        primary_current: "WeatherAPI",
        primary_hourly: weatherApiHourly.time.length ? "WeatherAPI" : "Open-Meteo",
        primary_daily: "Open-Meteo with WeatherAPI fallback",
        air_quality: "Open-Meteo Air + WeatherAPI"
      }
    };

    res.json(mergedData);
  } catch (error) {
    console.log("BACKEND ERROR:", error);
    res.status(500).json({ error: "Failed to fetch weather data" });
  }
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});