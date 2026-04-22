import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, CssBaseline } from '@mui/material';
import '@fontsource/roboto/300.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';

import { createAppTheme } from './theme';
import App from './App';
import { AppProvider, useApp } from './context/AppContext';

function ThemedApp() {
  const { themeMode } = useApp();
  const theme = React.useMemo(() => createAppTheme(themeMode), [themeMode]);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  );
}

createRoot(document.getElementById('root')).render(
  <AppProvider>
    <ThemedApp />
  </AppProvider>
);
