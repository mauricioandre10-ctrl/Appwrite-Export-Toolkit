/**
 * Configuración de PostCSS.
 * Usa el plugin de Tailwind CSS v4 para procesar las directivas @tailwind
 * y generar los estilos de utilidad. Es el entry point para el pipeline de estilos.
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
