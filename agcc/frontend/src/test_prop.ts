import { propagate } from './propagator';
const pos = propagate({ altitude_km: 500, inclination_deg: 97, raan_deg: 0, phase_deg: 0, epoch: new Date().toISOString() }, new Date());
console.log(pos);
