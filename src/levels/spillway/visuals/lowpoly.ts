// Temporary experiment: `?lowpoly=1` crudely decimates Spillway's heaviest geometry
// so a playtest can confirm that triangle count is what costs the frame on mobile.
// The look degrades; that is expected. Delete once the question is answered.
export const LOW_POLY =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('lowpoly') === '1';
