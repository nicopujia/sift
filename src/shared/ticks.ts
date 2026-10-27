// Parts of a short line that change between visits without the text changing:
// a clock time, "5 min ago", a view count, and the words that label them.

/** "3時間前", "5분 전": a relative time in scripts written without spaces, one word to \p{L}+. */
const TICKS_CJK = /\d+\s*(?:秒|分|分钟|分鐘|時間|小时|小時|日|天|週間|周|か月|ヶ月|个月|個月|年|초|분|시간|일|주|개월|년)\s*(?:前|전)/gu;
/**
 * Words that only label a time or a count ("Updated", "min read", "hace",
 * "views", "Publicidad"), and the units of time: a line of nothing else, once
 * its numbers are gone, says nothing about what the text is.
 */
const LABEL = new Set(
  (
    "updated update published posted edited modified last read reading time current duration elapsed remaining loaded progress ago just now today yesterday at on by of the a views view comments comment likes shares reads replies votes advertisement advert ad ads sponsored " +
    "s sec secs second seconds m min mins minute minutes h hr hrs hour hours d day days w wk week weeks mo month months y yr yrs year years " +
    "actualizado actualizada actualización publicado publicada editado modificado última lectura leer tiempo de del el la las los en hace hoy ayer ahora vistas visitas comentarios respuestas votos publicidad anuncio patrocinado " +
    "segundo segundos minuto minutos hora horas día días dia dias semana semanas mes meses año años " +
    "atualizado atualizada leitura há hoje ontem agora do da em às comentários mês ano anos " +
    "mis à jour publié publiée modifié lecture il y aujourd hui hier le du des vues commentaires publicité seconde secondes heure heures jour jours semaines mois an ans " +
    "aktualisiert veröffentlicht lesezeit vor heute gestern um am kommentare aufrufe werbung anzeige sekunde sekunden minuten stunde stunden std tag tage tagen woche wochen monat monate monaten jahr jahre jahren " +
    "aggiornato pubblicato lettura fa oggi ieri alle commenti visualizzazioni pubblicità secondo secondi minuti ora ore giorno giorni settimana settimane mese mesi anno anni " +
    "bijgewerkt gepubliceerd geleden leestijd vandaag gisteren seconden minuut uur dag dagen weken maand maanden jaar " +
    "temu zaktualizowano opublikowano dzisiaj wczoraj sekund sekundy minut minuty godzina godziny godzin dni tydzień tygodnie miesiąc miesiące rok lat " +
    "назад обновлено опубликовано сегодня вчера секунду секунды секунд минуту минуты минут час часа часов день дня дней неделю недели месяц месяца месяцев год года лет"
  ).split(" "),
);
/**
 * A time relative to now ("3hrs ago", "hace 3 horas", "vor 2 Tagen", "3時間前")
 * or a count of views, likes or comments: it changes on its own between
 * visits, whatever else a short line says ("BBC·3hrs ago", "Daily Mail · 266 comments").
 */
const VOLATILE = new RegExp(
  [
    "(?<!\\p{L})(?:ago|just now|geleden|temu|назад)(?!\\p{L})",
    "(?<!\\p{L})hace\\s+(?:\\d|un[oa]?s?\\s|pocos?\\s)",
    "(?<!\\p{L})(?:há|il y a|vor)\\s+(?:\\d+|uma?|une?|einer?|einem)\\s+(?:segundos?|minutos?|horas?|dias?|semanas?|mês|meses|anos?|secondes?|minutes?|heures?|jours?|semaines?|mois|ans?|sekunden?|minuten?|stunden?|tag(?:en)?|wochen?|monat(?:en)?|jahr(?:en)?)(?!\\p{L})",
    "\\d+\\s+(?:secondi|minuti|ore|giorni|settimane|mesi|anni)\\s+fa(?!\\p{L})",
    TICKS_CJK.source,
    "\\d[\\d.,]*\\s*[kmb]?\\s+(?:\\p{L}+\\s+){0,2}(?:views?|viewers?|watching|likes?|comments?|shares?|reads?|vistas?|visitas?|viendo|reproducciones|visualizaciones|comentarios?|vues|commentaires?|aufrufe|kommentare|visualizzazioni|commenti)(?!\\p{L})",
  ].join("|"),
  "iu",
);

/**
 * Whether a short line only ticks: it has a time relative to now or a count
 * (see VOLATILE), or it is only a label once the parts `tick` matches (a
 * clock time, a duration) and its numbers are gone: "Updated 10:32",
 * "Comentarios (12)". "Doors open at 19:30." and "Pool: closed" say something.
 */
export function onlyTicks(line: string, tick: RegExp): boolean {
  if (VOLATILE.test(line)) return true;
  const all = new RegExp(tick.source, tick.flags.includes("g") ? tick.flags : tick.flags + "g");
  const rest = line.replace(all, " ").replace(TICKS_CJK, " ").toLowerCase().match(/\p{L}+/gu) ?? [];
  return rest.every((w) => LABEL.has(w));
}
