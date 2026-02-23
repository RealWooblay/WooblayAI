export type Weather = 'storm' | 'rain' | 'cloudy' | 'sunny' | 'rainbow';

export function trustToWeather(trust: number): Weather {
  if (trust <= 20) return 'storm';
  if (trust <= 40) return 'rain';
  if (trust <= 60) return 'cloudy';
  if (trust <= 80) return 'sunny';
  return 'rainbow';
}

export function WeatherBackground(_props: { weather: Weather }) {
  return null;
}
