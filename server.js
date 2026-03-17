require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const WEATHERAPI_KEY = process.env.WEATHERAPI_KEY;

// Exact Moga, Punjab, India coordinates
const LAT = 30.8165;
const LON = 75.1717;

app.get("/", (req, res) => {
  res.send("Moga weather backend is running");
});

function firstAvailable(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return null;
}

app.get("/api/weather", async (req, res) => {
  try {
    const openMeteoWeatherUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,wind_speed_10m,wind_direction_10m,weather_code,is_day,relative_humidity_2m,apparent_temperature,surface_pressure&hourly=temperature_2m,weather_code,is_day,visibility&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max&timezone=auto&forecast_days=7`;

    const openMeteoAirUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${LAT}&longitude=${LON}&hourly=pm2_5&timezone=auto`;

    // Use exact coordinates instead of "Moga"
    const weatherApiUrl =
      `https://api.weatherapi.com/v1/forecast.json?key=${WEATHERAPI_KEY}&q=${LAT},${LON}&days=7&aqi=yes&alerts=no`;

    const [openMeteoWeatherResponse, openMeteoAirResponse, weatherApiResponse] = await Promise.all([
      fetch(openMeteoWeatherUrl),
      fetch(openMeteoAirUrl),
      fetch(weatherApiUrl)
    ]);

    const openMeteoWeather = await openMeteoWeatherResponse.json();
    const openMeteoAir = await openMeteoAirResponse.json();
    const weatherApiData = await weatherApiResponse.json();

    console.log("OPEN METEO WEATHER:", JSON.stringify(openMeteoWeather, null, 2));
    console.log("OPEN METEO AIR:", JSON.stringify(openMeteoAir, null, 2));
    console.log("WEATHER API:", JSON.stringify(weatherApiData, null, 2));

    const mergedData = {
      location: {
        name: firstAvailable(weatherApiData.location?.name, "Moga"),
        region: firstAvailable(weatherApiData.location?.region, "Punjab"),
        country: firstAvailable(weatherApiData.location?.country, "India"),
        latitude: firstAvailable(weatherApiData.location?.lat, LAT),
        longitude: firstAvailable(weatherApiData.location?.lon, LON)
      },

      current: {
        temperature_c: firstAvailable(
          openMeteoWeather.current?.temperature_2m,
          weatherApiData.current?.temp_c
        ),
        feelslike_c: firstAvailable(
          openMeteoWeather.current?.apparent_temperature,
          weatherApiData.current?.feelslike_c
        ),
        humidity: firstAvailable(
          openMeteoWeather.current?.relative_humidity_2m,
          weatherApiData.current?.humidity
        ),
        wind_kph: firstAvailable(
          openMeteoWeather.current?.wind_speed_10m,
          weatherApiData.current?.wind_kph
        ),
        wind_degree: firstAvailable(
          openMeteoWeather.current?.wind_direction_10m,
          weatherApiData.current?.wind_degree
        ),
        pressure_hpa: firstAvailable(
          openMeteoWeather.current?.surface_pressure,
          weatherApiData.current?.pressure_mb
        ),
        is_day: firstAvailable(
          openMeteoWeather.current?.is_day,
          weatherApiData.current?.is_day
        ),
        weather_code: firstAvailable(
          openMeteoWeather.current?.weather_code,
          0
        ),
        condition_text: firstAvailable(
          weatherApiData.current?.condition?.text,
          null
        ),
        uv: firstAvailable(
          weatherApiData.current?.uv,
          openMeteoWeather.daily?.uv_index_max?.[0]
        ),
        air_quality_pm25: firstAvailable(
          openMeteoAir.hourly?.pm2_5?.[0],
          weatherApiData.current?.air_quality?.pm2_5
        )
      },

      daily: {
        time: openMeteoWeather.daily?.time || [],
        weather_code: openMeteoWeather.daily?.weather_code || [],
        temperature_2m_max: openMeteoWeather.daily?.temperature_2m_max || [],
        temperature_2m_min: openMeteoWeather.daily?.temperature_2m_min || [],
        precipitation_probability_max: openMeteoWeather.daily?.precipitation_probability_max || [],
        sunrise: openMeteoWeather.daily?.sunrise || [],
        sunset: openMeteoWeather.daily?.sunset || [],
        uv_index_max: openMeteoWeather.daily?.uv_index_max || []
      },

      hourly: {
        time: openMeteoWeather.hourly?.time || [],
        temperature_2m: openMeteoWeather.hourly?.temperature_2m || [],
        weather_code: openMeteoWeather.hourly?.weather_code || [],
        is_day: openMeteoWeather.hourly?.is_day || [],
        visibility: openMeteoWeather.hourly?.visibility || []
      },

      debug: {
        openMeteoDailyExists: !!openMeteoWeather.daily,
        openMeteoHourlyExists: !!openMeteoWeather.hourly,
        openMeteoDailyTimeCount: openMeteoWeather.daily?.time?.length || 0,
        openMeteoHourlyTimeCount: openMeteoWeather.hourly?.time?.length || 0
      },

      source: {
        primary_weather: "Open-Meteo",
        fallback_weather: "WeatherAPI",
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