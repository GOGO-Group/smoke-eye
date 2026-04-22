import { createTheme } from '@mui/material/styles';

export function createAppTheme(mode = 'dark') {
  const isDark = mode === 'dark';
  return createTheme({
    palette: {
      mode,
      primary: { main: '#3b82f6' },
      secondary: { main: '#f59e0b' },
      background: {
        default: isDark ? '#121212' : '#f0f2f5',
        paper:   isDark ? '#1e1e1e' : '#ffffff',
      },
    },
    shape: { borderRadius: 10 },
    typography: {
      fontSize: 13,
      button: { textTransform: 'none', fontWeight: 500 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          'html, body, #root': {
            height: '100%', margin: 0, overflow: 'hidden', userSelect: 'none',
          },
          '::-webkit-scrollbar': { width: 6, height: 6 },
          '::-webkit-scrollbar-track': { background: 'transparent' },
          '::-webkit-scrollbar-thumb': {
            background: isDark ? '#52525b' : '#b0b0b0', borderRadius: 3,
          },
          '::-webkit-scrollbar-thumb:hover': {
            background: isDark ? '#71717a' : '#909090',
          },
          '*': {
            scrollbarWidth: 'thin',
            scrollbarColor: isDark ? '#52525b transparent' : '#b0b0b0 transparent',
          },
          '*, *::before, *::after': { cursor: 'default !important' },
          mark: { background: '#fbbf24', color: '#000', padding: '0 2px', borderRadius: 2 },
          webview: { display: 'flex', flex: 1 },
        },
      },
      MuiPaper: { defaultProps: { elevation: 0 } },
      MuiButton: { defaultProps: { disableElevation: true } },
      MuiTextField: { defaultProps: { size: 'small', variant: 'outlined' } },
    },
  });
}

export default createAppTheme('dark');
