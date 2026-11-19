// Pinta de inmediato el rol del usuario y las secciones de su menú con
// lo que ya se sabe de esta sesión, en lugar de esperar a que Firebase
// confirme la sesión y la API responda (eso hacía que el encabezado y
// el menú "brincaran" en cada cambio de sección). Va al final del
// encabezado y sin defer para correr antes del primer pintado.
// auth.js confirma después el rol con el backend y corrige si cambió.
// Seguro de la transición entre secciones (ver styles.css): mientras
// dura, la página no recibe clics. Normalmente termina en un tercio de
// segundo; si algún navegador no la termina, se salta al segundo y se
// muestra la página nueva tal cual.
addEventListener('pagereveal', evento => {
  const transicion = evento.viewTransition;
  if (!transicion) return;
  const seguro = setTimeout(() => transicion.skipTransition(), 1000);
  transicion.finished.finally(() => clearTimeout(seguro));
});

(function () {
  let rol = null;
  let correo = null;
  try {
    rol = sessionStorage.getItem('panel:rol');
    correo = sessionStorage.getItem('panel:correo');
  } catch (error) { /* sin caché disponible */ }
  const etiquetas = { administrador: 'Administrador', coordinador: 'Coordinador' };
  if (!rol || !correo || !etiquetas[rol]) return;
  const usuario = document.getElementById('coordinator');
  if (usuario) usuario.textContent = `${etiquetas[rol]}: ${correo}`;
  if (rol === 'administrador') {
    document.querySelectorAll('[data-solo-admin]').forEach(enlace => { enlace.hidden = false; });
  }
})();
