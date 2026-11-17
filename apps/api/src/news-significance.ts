/** Publisher wording about broad service disruption, without inferring its cause. */
export function isMajorServiceDisruption(text: string): boolean {
  const value = text.slice(0, 2500).toLowerCase();
  if (/\b(?:no|without) (?:service )?outage\b/.test(value)) return false;
  const interruption = /\b(?:outage|service disruption|services? (?:down|unavailable)|mail disruption|panne|ausfall|störung|caída|interrupci[oó]n|avaria|indisponibilit[ée])\b/;
  const infrastructure = /\b(?:email|banking|payments?|internet|cloud|telecom|microsoft|outlook|exchange online|google workspace|cloudflare|aws)\b/;
  const scale = /\b(?:global|worldwide|widespread|major|millions|nationwide|mondial[a-z]*|weltweit|mundial[a-z]*)\b/;
  return interruption.test(value) && infrastructure.test(value) && (scale.test(value) || /\b(?:outlook|microsoft 365|exchange online)\b/.test(value));
}
