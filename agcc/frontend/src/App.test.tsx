import { render, screen } from '@testing-library/react'
import App from './App'

test('renders bootstrap message', () => {
  render(<App />)
  expect(screen.getByText('AGCC bootstrap ready')).toBeTruthy()
})
