require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const WEATHERAPI_KEY = process.env.WEATHERAPI_KEY;
const TOMORROW_API_KEY = process.env.TOMORROW_API_KEY;

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
    if (value !== undefined && value !== null && !Number.isNaN(value)) return value;
  }
  return null;
}

function weightedAverage(weightedValues) {
  const valid = weightedValues.filter(item => item.value !== undefined && item.value !== null && !isNaN(item.value));
  if (!valid.length) return null;

  const totalWeight = valid.reduce((sum, item) => sum + item.weight, 0);
  const weightedSum = valid.reduce((sum, item) => sum + item.value * item.weight, 0);

  return weightedSum / totalWeight;
}

function convert12hTo24h(time12h) {
  if (!time12h) return "00:00:00";

  const [time, modifier] = time12h.split(" ");
  let [hours, minutes] = time.split(":");

  if (hours === "12") hours = "00";
  if (modifier === "PM") hours = String(parseInt(hours, 10) + 12);

  return `${hours.padStart(2, "0")}:${minutes}:00`;
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

function mapTomorrowCodeToWeatherCode(code) {
  const map = {
    1000: 0,
    1100: 1,
    1101: 2,
    1102: 3,
    1001: 3,
    2000: 45,
    2100: 45,
    4000: 53,
    4001: 63,
    4200: 80,
    4201: 63,
    5000: 73,
    5001: 73,
    5100: 73,
    5101: 73,
    6000: 53,
    6001: 63,
    6200: 80,
    6201: 63,
    7000: 45,
    7101: 45,
    7102: 45,
    8000: 95
  };
  return map[code] ?? 0;
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
      hourly.time.push(hour.time.replace(" ", "T"));
      hourly.temperature_2m.push(hour.temp_c ?? null);
      hourly.weather_code.push(mapWeatherApiConditionToCode(hour.condition?.text));
      hourly.is_day.push(hour.is_day ?? null);
      hourly.visibility.push(hour.vis_km != null ? hour.vis_km * 1000 : null);
      hourly.humidity.push(hour.humidity ?? null);
      hourly.wind_kph.push(hour.wind_kph ?? null);
    });
  });

  return hourly;
}

function buildHourlyFromOpenMeteo(openMeteoWeather) {
  return {
    time: openMeteoWeather.hourly?.time || [],
    temperature_2m: openMeteoWeather.hourly?.temperature_2m || [],
    weather_code: openMeteoWeather.hourly?.weather_code || [],
    is_day: openMeteoWeather.hourly?.is_day || [],
    visibility: openMeteoWeather.hourly?.visibility || [],
    humidity: openMeteoWeather.hourly?.relative_humidity_2m || [],
    wind_kph: openMeteoWeather.hourly?.wind_speed_10m || []
  };
}

function blendHourlySeries(primary, secondary) {
  const times = primary.time?.length ? primary.time : secondary.time || [];

  return {
    time: times,
    temperature_2m: times.map((_, i) =>
      weightedAverage([
        { value: primary.temperature_2m?.[i], weight: 0.55 },
        { value: secondary.temperature_2m?.[i], weight: 0.45 }
      ])
    ),
    weather_code: times.map((_, i) =>
      firstAvailable(primary.weather_code?.[i], secondary.weather_code?.[i], 0)
    ),
    is_day: times.map((_, i) =>
      firstAvailable(primary.is_day?.[i], secondary.is_day?.[i], 1)
    ),
    visibility: times.map((_, i) =>
      weightedAverage([
        { value: primary.visibility?.[i], weight: 0.55 },
        { value: secondary.visibility?.[i], weight: 0.45 }
      ])
    ),
    humidity: times.map((_, i) =>
      weightedAverage([
        { value: primary.humidity?.[i], weight: 0.55 },
        { value: secondary.humidity?.[i], weight: 0.45 }
      ])
    ),
    wind_kph: times.map((_, i) =>
      weightedAverage([
        { value: primary.wind_kph?.[i], weight: 0.55 },
        { value: secondary.wind_kph?.[i], weight: 0.45 }
      ])
    )
  };
}

function buildDailyFromTomorrow(tomorrowData) {
  const dailyTimelines = tomorrowData.timelines?.daily || [];

  return {
    time: dailyTimelines.map(day => day.time.split("T")[0]),
    weather_code: dailyTimelines.map(day => mapTomorrowCodeToWeatherCode(day.values?.weatherCodeMax ?? day.values?.weatherCodeMin ?? 1000)),
    temperature_2m_max: dailyTimelines.map(day => day.values?.temperatureMax ?? null),
    temperature_2m_min: dailyTimelines.map(day => day.values?.temperatureMin ?? null),
    precipitation_probability_max: dailyTimelines.map(day => day.values?.precipitationProbabilityMax ?? 0),
    uv_index_max: dailyTimelines.map(day => day.values?.uvIndexMax ?? 0)
  };
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

function buildDailyFromOpenMeteo(openMeteoWeather) {
  return {
    time: openMeteoWeather.daily?.time || [],
    weather_code: openMeteoWeather.daily?.weather_code || [],
    temperature_2m_max: openMeteoWeather.daily?.temperature_2m_max || [],
    temperature_2m_min: openMeteoWeather.daily?.temperature_2m_min || [],
    precipitation_probability_max: openMeteoWeather.daily?.precipitation_probability_max || [],
    sunrise: openMeteoWeather.daily?.sunrise || [],
    sunset: openMeteoWeather.daily?.sunset || [],
    uv_index_max: openMeteoWeather.daily?.uv_index_max || []
  };
}

function blendDailySeries(tomorrowDaily, weatherApiDaily, openMeteoDaily) {
  const times = tomorrowDaily.time?.length
    ? tomorrowDaily.time
    : weatherApiDaily.time?.length
    ? weatherApiDaily.time
    : openMeteoDaily.time || [];

  return {
    time: times,
    weather_code: times.map((_, i) =>
      firstAvailable(tomorrowDaily.weather_code?.[i], weatherApiDaily.weather_code?.[i], openMeteoDaily.weather_code?.[i], 0)
    ),
    temperature_2m_max: times.map((_, i) =>
      weightedAverage([
        { value: tomorrowDaily.temperature_2m_max?.[i], weight: 0.5 },
        { value: weatherApiDaily.temperature_2m_max?.[i], weight: 0.3 },
        { value: openMeteoDaily.temperature_2m_max?.[i], weight: 0.2 }
      ])
    ),
    temperature_2m_min: times.map((_, i) =>
      weightedAverage([
        { value: tomorrowDaily.temperature_2m_min?.[i], weight: 0.5 },
        { value: weatherApiDaily.temperature_2m_min?.[i], weight: 0.3 },
        { value: openMeteoDaily.temperature_2m_min?.[i], weight: 0.2 }
      ])
    ),
    precipitation_probability_max: times.map((_, i) =>
      firstAvailable(
        tomorrowDaily.precipitation_probability_max?.[i],
        weatherApiDaily.precipitation_probability_max?.[i],
        openMeteoDaily.precipitation_probability_max?.[i],
        0
      )
    ),
    sunrise: times.map((_, i) =>
      firstAvailable(weatherApiDaily.sunrise?.[i], openMeteoDaily.sunrise?.[i], null)
    ),
    sunset: times.map((_, i) =>
      firstAvailable(weatherApiDaily.sunset?.[i], openMeteoDaily.sunset?.[i], null)
    ),
    uv_index_max: times.map((_, i) =>
      firstAvailable(
        tomorrowDaily.uv_index_max?.[i],
        weatherApiDaily.uv_index_max?.[i],
        openMeteoDaily.uv_index_max?.[i],
        0
      )
    )
  };
}

function mergeMonthlyData(historical, forecast) {
  const map = {};

  const addDay = (date, code, max, min) => {
    map[date] = {
      date,
      weather_code: code,
      max_temp: max,
      min_temp: min
    };
  };

  if (historical?.daily?.time?.length) {
    for (let i = 0; i < historical.daily.time.length; i++) {
      addDay(
        historical.daily.time[i],
        historical.daily.weather_code?.[i] ?? 0,
        historical.daily.temperature_2m_max?.[i] ?? null,
        historical.daily.temperature_2m_min?.[i] ?? null
      );
    }
  }

  if (forecast?.time?.length) {
    for (let i = 0; i < forecast.time.length; i++) {
      addDay(
        forecast.time[i],
        forecast.weather_code?.[i] ?? 0,
        forecast.temperature_2m_max?.[i] ?? null,
        forecast.temperature_2m_min?.[i] ?? null
      );
    }
  }

  return Object.values(map).sort((a, b) => new Date(a.date) - new Date(b.date));
}

app.get("/", (req, res) => {
  res.send("Moga weather backend is running");
});

app.get("/api/weather", async (req, res) => {
  try {
    const requestedCity = (req.query.city || "moga").toLowerCase();
    const location = LOCATIONS[requestedCity] || LOCATIONS.moga;

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const yesterday = `${year}-${month}-${String(Math.max(1, now.getDate() - 1)).padStart(2, "0")}`;
    const monthStart = `${year}-${month}-01`;

    const tomorrowUrl =
      `https://api.tomorrow.io/v4/weather/forecast?location=${location.lat},${location.lon}&apikey=${TOMORROW_API_KEY}&timesteps=1d&units=metric`;

    const weatherApiUrl =
      `https://api.weatherapi.com/v1/forecast.json?key=${WEATHERAPI_KEY}&q=${location.lat},${location.lon}&days=7&aqi=yes&alerts=no`;

    const openMeteoWeatherUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}&hourly=temperature_2m,weather_code,is_day,visibility,relative_humidity_2m,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max&timezone=auto&forecast_days=7`;

    const openMeteoAirUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${location.lat}&longitude=${location.lon}&hourly=pm2_5&timezone=auto`;

    const openMeteoHistoricalUrl =
      `https://archive-api.open-meteo.com/v1/archive?latitude=${location.lat}&longitude=${location.lon}&start_date=${monthStart}&end_date=${yesterday}&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto`;

    const [
      tomorrowResponse,
      weatherApiResponse,
      openMeteoWeatherResponse,
      openMeteoAirResponse,
      openMeteoHistoricalResponse
    ] = await Promise.all([
      fetch(tomorrowUrl),
      fetch(weatherApiUrl),
      fetch(openMeteoWeatherUrl),
      fetch(openMeteoAirUrl),
      fetch(openMeteoHistoricalUrl)
    ]);

    const tomorrowData = await tomorrowResponse.json();
    const weatherApiData = await weatherApiResponse.json();
    const openMeteoWeather = await openMeteoWeatherResponse.json();
    const openMeteoAir = await openMeteoAirResponse.json();
    const openMeteoHistorical = await openMeteoHistoricalResponse.json();

    const weatherApiHourly = buildHourlyFromWeatherApi(weatherApiData);
    const openMeteoHourly = buildHourlyFromOpenMeteo(openMeteoWeather);
    const mergedHourly = blendHourlySeries(weatherApiHourly, openMeteoHourly);

    const tomorrowDaily = buildDailyFromTomorrow(tomorrowData);
    const weatherApiDaily = buildDailyFromWeatherApi(weatherApiData);
    const openMeteoDaily = buildDailyFromOpenMeteo(openMeteoWeather);
    const mergedDaily = blendDailySeries(tomorrowDaily, weatherApiDaily, openMeteoDaily);

    const monthly = mergeMonthlyData(openMeteoHistorical, mergedDaily);

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

    const currentTemp = firstAvailable(
  openMeteoWeather.current?.temperature_2m,
  weatherApiData.current?.temp_c
);

    const currentHumidity = weightedAverage([
      { value: weatherApiData.current?.humidity, weight: 0.55 },
      { value: openMeteoWeather.current?.relative_humidity_2m, weight: 0.45 }
    ]);

    const currentWind = weightedAverage([
      { value: weatherApiData.current?.wind_kph, weight: 0.55 },
      { value: openMeteoWeather.current?.wind_speed_10m, weight: 0.45 }
    ]);

    res.json({
      location: {
        key: location.key,
        name: firstAvailable(weatherApiData.location?.name, location.name),
        region: firstAvailable(weatherApiData.location?.region, location.region),
        country: firstAvailable(weatherApiData.location?.country, location.country),
        latitude: firstAvailable(weatherApiData.location?.lat, location.lat),
        longitude: firstAvailable(weatherApiData.location?.lon, location.lon)
      },

      current: {
        temperature_c: currentTemp,
        feelslike_c: firstAvailable(weatherApiData.current?.feelslike_c, openMeteoWeather.current?.apparent_temperature),
        humidity: currentHumidity,
        wind_kph: currentWind,
        wind_degree: firstAvailable(weatherApiData.current?.wind_degree, openMeteoWeather.current?.wind_direction_10m),
        pressure_hpa: firstAvailable(weatherApiData.current?.pressure_mb, openMeteoWeather.current?.surface_pressure),
        is_day: firstAvailable(openMeteoWeather.current?.is_day, weatherApiData.current?.is_day, 1),
        weather_code: firstAvailable(
          openMeteoWeather.current?.weather_code,
          mapWeatherApiConditionToCode(weatherApiData.current?.condition?.text),
          0
        ),
        condition_text: firstAvailable(weatherApiData.current?.condition?.text, null),
        uv: firstAvailable(mergedDaily.uv_index_max?.[0], weatherApiData.current?.uv),
        air_quality_pm25: firstAvailable(openMeteoAir.hourly?.pm2_5?.[nearestAirIndex], weatherApiData.current?.air_quality?.pm2_5)
      },

      daily: mergedDaily,
      hourly: mergedHourly,
      monthly,

      debug: {
        weatherApiHourlyCount: weatherApiHourly.time.length,
        openMeteoHourlyCount: openMeteoHourly.time.length,
        tomorrowDailyCount: tomorrowDaily.time.length,
        weatherApiDailyCount: weatherApiDaily.time.length,
        openMeteoDailyCount: openMeteoDaily.time.length
      },

      source: {
        primary_current_temp: "Open-Meteo",
        primary_current_condition: "Open-Meteo",
        primary_hourly: "WeatherAPI + Open-Meteo",
        primary_daily_temp: "Tomorrow.io + WeatherAPI + Open-Meteo",
        monthly_history: "Open-Meteo Archive + Blended Forecast",
        air_quality: "Open-Meteo Air + WeatherAPI"
      }
    });
  } catch (error) {
    console.log("BACKEND ERROR:", error);
    res.status(500).json({ error: "Failed to fetch weather data" });
  }
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});