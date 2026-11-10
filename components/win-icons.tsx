/** Íconos de ventana dibujados (los símbolos 🗕 🗖 🗗 no existen en muchos celulares y se ven como un cuadro vacío). */
const P = { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true } as const;
export const IconMin = () => <svg {...P}><path d="M2.5 10.5h9" strokeLinecap="round" /></svg>;
export const IconMax = () => <svg {...P}><rect x="2.5" y="2.5" width="9" height="9" rx="1.2" /></svg>;
export const IconRestore = () => <svg {...P}><rect x="2.5" y="4.5" width="7" height="7" rx="1" /><path d="M4.5 4.5V2.8c0-.2.1-.3.3-.3h6.4c.2 0 .3.1.3.3v6.4c0 .2-.1.3-.3.3H9.5" /></svg>;
