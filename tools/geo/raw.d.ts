// vitest (vite) loads a file as a string with the ?raw suffix.
declare module '*?raw' {
  const content: string;
  export default content;
}
