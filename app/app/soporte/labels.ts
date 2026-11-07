export const CATS: Record<string, string> = { acceso: 'Acceso / contraseña', plataforma: 'Uso de la plataforma', aula_virtual: 'Aula virtual / video', pagos: 'Pagos', academico: 'Notas y asistencia', general: 'Otro' };
export const ST: Record<string, [string, 'amber' | 'blue' | 'green' | 'gray']> = {
  abierto: ['Abierto', 'amber'], en_progreso: ['En atención', 'blue'], esperando_usuario: ['Esperando su respuesta', 'amber'], resuelto: ['Resuelto', 'green'], cerrado: ['Cerrado', 'gray'],
};
