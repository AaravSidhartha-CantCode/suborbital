import { describe, expect, test } from 'vitest'
import { weatherCondition, type WeatherVisual } from './LiveWeather'

const weather = (kind: WeatherVisual['kind'], precipitation: number, cloudCover: number): WeatherVisual => ({
  kind,
  intensity: 1,
  precipitation_mm_per_hr: precipitation,
  cloud_cover_pct: cloudCover,
})

describe('weatherCondition', () => {
  test.each([
    [weather('clear', 0, 10), 'Sunny'],
    [weather('partly', 0, 45), 'Partly cloudy'],
    [weather('cloud', 0, 80), 'Cloudy'],
    [weather('cloud', 0, 95), 'Overcast'],
    [weather('rain', 0.2, 90), 'Light rain'],
    [weather('rain', 1.5, 90), 'Rain'],
    [weather('rain', 5, 100), 'Heavy rain'],
  ])('returns the shared display label for %#', (visual, expected) => {
    expect(weatherCondition(visual)).toBe(expected)
  })
})
