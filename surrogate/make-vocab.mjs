// writes surrogate/vocab.json (cancer + regimen lists) so python and the app agree on the columns
import { writeFileSync } from "node:fs";
import { CANCER_TYPES } from "../cancers.js";
import { REGIMENS, regimenTreatments } from "../schedules.js";
import { TREATMENT_GROUP } from "./surrogate.js";
const groups = [...new Set(Object.values(TREATMENT_GROUP))];
const regimenGroups = Object.fromEntries(Object.entries(REGIMENS).map(([id, r]) => [id, [...new Set(regimenTreatments(r).map((t) => TREATMENT_GROUP[t]))]]));
writeFileSync(new URL("./vocab.json", import.meta.url), JSON.stringify({ cancers: Object.keys(CANCER_TYPES), regimens: Object.keys(REGIMENS), groups, regimenGroups }, null, 1));
console.log("wrote vocab.json:", Object.keys(CANCER_TYPES).length, "cancers,", Object.keys(REGIMENS).length, "regimens,", groups.length, "treatment groups");
