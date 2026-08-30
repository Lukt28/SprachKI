# Rena — bolivianisches Spanisch lernen 🇧🇴

Eine App fürs iPhone, mit der du **im Gespräch** bolivianisches Spanisch lernst — freihändig,
während du die Wohnung aufräumst. Rena ist eine Paceña aus La Paz, versteht dich auf Deutsch
und auf Spanisch, und antwortet auf echtem Hochlandspanisch (`¿no ve?`, `pues`, `harto`, `nomás`)
statt auf Lehrbuchspanisch.

Kein Mac nötig, keine App-Store-Freigabe, keine laufenden Kosten: Die App ist eine
**Web-App (PWA)**, die du dir über Safari auf den Home-Bildschirm legst. Danach sieht und
verhält sie sich wie eine normale iPhone-App.

---

## Was drin ist

| | |
|---|---|
| 🎙️ **Freihand-Mikrofon** | Läuft dauerhaft mit. Rena erkennt selbst, wann du zu Ende gesprochen hast, und antwortet. Kein Knopfdrücken zwischendurch. |
| 🗣️ **Rena spricht** | Antworten werden laut vorgelesen — mit einer spanischen iOS-Stimme, kostenlos und offline. |
| 🇩🇪🇧🇴 **Deutsch & Spanisch** | Sprich, wie es dir gerade rauskommt. Rena antwortet trotzdem auf Spanisch und hilft auf Deutsch nach, wenn du hängst. |
| ✍️ **Sanfte Korrekturen** | Fehler erscheinen als Notiz im Chat, nicht im gesprochenen Text — so bleibt das Gespräch ein Gespräch. |
| 📖 **Wörterbuch** | Vokabeln und ganze Sätze aus dem Gespräch mit einem Tipp aufnehmen. Oder per Sprachbefehl. |
| 🎯 **Abfrage** | Rena fragt dich freihändig im Gespräch ab — oder du übst still mit Karteikarten nach dem Leitner-System. |
| 🔀 **Drei Anbieter** | Groq, Mistral oder Gemini — umschaltbar in den Einstellungen, ohne Datenverlust. |
| 📴 **Offline startklar** | Wörterbuch und Abfrage funktionieren ohne Internet. Nur das Gespräch mit Rena braucht Netz. |

---

## Einrichten — vier Schritte

### 1. Anbieter wählen und Schlüssel holen

Rena kann mit drei kostenlosen KI-Anbietern sprechen. Du wählst sie in den App-Einstellungen
und kannst jederzeit wechseln — die Schlüssel der anderen bleiben dabei gespeichert.

| Anbieter | Gut daran | Zu bedenken |
|---|---|---|
| **Groq** | Sehr schnell, großzügiges Gratis-Kontingent, laut AGB **kein Training auf deinen Eingaben**. Kein Gewerbe-Nachweis. | Braucht zwei Aufrufe pro Antwort (erst Whisper zum Transkribieren, dann das Sprachmodell). Merkt man kaum. |
| **Mistral** | Französischer Anbieter mit echten **Verbraucher-AGB** — für private Nutzung juristisch der sauberste Weg. | Ebenfalls zwei Aufrufe (Voxtral zum Transkribieren). Kleineres Gratis-Kontingent. |
| **Google Gemini** | Beste Deutsch/Spanisch-Erkennung: versteht die Aufnahme direkt, ein Aufruf pro Antwort. | Beim ersten Besuch verlangt Google die Bestätigung, den Dienst **geschäftlich** zu nutzen. Im Gratis-Tarif wertet Google Eingaben zur Modellverbesserung aus. |

Schlüssel holen — dauert überall etwa eine Minute, Kreditkarte braucht keiner:

- **Groq:** [console.groq.com/keys](https://console.groq.com/keys) → *Create API Key*
- **Mistral:** [console.mistral.ai/api-keys](https://console.mistral.ai/api-keys) → *Create new key*
- **Gemini:** [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → *Create API key*

Dann in Rena: **Einstellungen → Anbieter** antippen, Schlüssel einfügen, auf
**⇄ Verbindung testen** tippen. Der Test prüft in einem Rutsch, ob der Anbieter erreichbar ist,
ob dein Schlüssel gilt und ob das gewählte Modell existiert.

> **Warum der Verbindungstest wichtig ist:** Die App läuft ohne eigenen Server — sie ruft die
> KI direkt aus deinem Browser auf. Dafür muss der Anbieter browserseitige Aufrufe erlauben
> (CORS). Bei Gemini ist das gesichert; bei Groq und Mistral konnte ich es nicht selbst
> nachprüfen. Der Test sagt dir in zwei Sekunden, ob es klappt. Falls nicht, meldet er das
> ausdrücklich — dann nimm einen anderen Anbieter.

### 2. App veröffentlichen (einmalig)

Die App braucht **HTTPS** — nur dann gibt iOS das Mikrofon frei. Ohne HTTPS bleibt der
Mikrofonknopf wirkungslos, deshalb führt an diesem Schritt kein Weg vorbei.

> ⚠️ **Dieses Repository ist derzeit privat.** GitHub Pages funktioniert für private
> Repositories nur mit einem bezahlten Plan (GitHub Pro/Team). Wähle deshalb einen der
> beiden folgenden Wege.

#### Weg A — Repository öffentlich schalten, dann GitHub Pages *(am einfachsten)*

Im Code stecken keine Geheimnisse: Der API-Schlüssel wird ausschließlich im Speicher
deines iPhones abgelegt und ist nie Teil des Repositorys. Öffentlich schalten ist also
unbedenklich.

1. **Settings → General →** ganz unten **Danger Zone → Change visibility → Public**.
2. **Settings → Pages →** unter *Build and deployment* bei **Source** → **GitHub Actions**.
3. **Actions →** Workflow *„Auf GitHub Pages veröffentlichen"* → **Run workflow**
   (oder einfach den nächsten Commit abwarten).

Danach läuft die App unter:

```
https://lukt28.github.io/SprachKI/
```

#### Weg B — Repository privat lassen, woanders veröffentlichen

**Cloudflare Pages** und **Netlify** hosten auch private Repositories gratis mit HTTPS:

1. Bei [Cloudflare Pages](https://pages.cloudflare.com) oder [Netlify](https://app.netlify.com)
   mit dem GitHub-Konto anmelden.
2. Dieses Repository auswählen.
3. **Build command:** leer lassen · **Publish/Output directory:** `/` (Projektwurzel).
   Die App braucht keinen Build-Schritt.
4. Die vergebene `https://…`-Adresse verwenden.

> **Zum Workflow:** Er veröffentlicht immer den **Standard-Branch** des Repositorys — egal
> wie der heißt. Aktuell ist das `claude/bolivian-spanish-learning-app-esos2y`. Benennst du
> ihn später in `main` um oder mergst dorthin, funktioniert es unverändert weiter.

### 3. Aufs iPhone legen

1. Die Adresse oben **in Safari** öffnen (nicht in Chrome — nur Safari darf Web-Apps installieren).
2. Unten auf **Teilen** (das Quadrat mit Pfeil) tippen.
3. **„Zum Home-Bildschirm"** wählen → **Hinzufügen**.

Jetzt liegt Rena als Symbol auf dem Home-Bildschirm und startet ohne Safari-Leiste im Vollbild.

### 4. In der App einrichten

1. **Einstellungen** → Anbieter wählen, Schlüssel einfügen, **⇄ Verbindung testen**.
2. **Stimme** wählen und mit **▶︎ Anhören** testen.
   *Peruanisch oder kolumbianisch klingt dem bolivianischen Hochland am nächsten.*
   Fehlt eine spanische Stimme? → iPhone-Einstellungen → **Bedienungshilfen → Vorlesen → Stimmen → Spanisch** herunterladen.
3. **Dein Niveau** einstellen (A1 bis C1) — das steuert Renas Tempo und wie viel Deutsch sie benutzt.
4. Zurück auf **Gespräch**, aufs **Mikrofon** tippen, Zugriff erlauben — und losreden.

---

## Freihändig benutzen

Genau dafür ist die App gebaut:

- Einmal aufs Mikrofon tippen — es bleibt an, bis du es wieder ausschaltest.
- iPhone hinstellen oder in die Tasche stecken, Lautsprecher an, aufräumen.
- Rena erkennt Sprechpausen selbst und antwortet dann. Du musst nichts antippen.
- Die Einstellung **„Bildschirm anlassen"** verhindert, dass sich das iPhone sperrt.

**Wichtig:** Sperrt sich der Bildschirm doch oder wechselst du die App, schaltet iOS das
Mikrofon von Web-Apps ab. Lass Rena deshalb im Vordergrund offen. (Das ist eine Grenze von
iOS für alle Web-Apps — nur eine echte, über Xcode gebaute App dürfte im Hintergrund weiterhören.)

**Bei lauter Umgebung** (Staubsauger, Wasser, Musik): In den Einstellungen die
**Empfindlichkeit** hochdrehen — dann ignoriert Rena Nebengeräusche. Hört sie dich zu früh
ab, hilft eine längere **Sprechpause bis zur Antwort**.

---

## Sprachbefehle

Mitten im Gespräch sagen, ohne etwas anzutippen:

| Sag … | … und Rena |
|---|---|
| „Rena, merk dir das" · „Apunta eso" | nimmt das Besprochene ins Wörterbuch auf |
| „Frag mich ab" · „Pregúntame" | startet die Abfrage aus deinem Wörterbuch |
| „Ya basta" · „Stopp, genug" | beendet die Abfrage und plaudert weiter |
| „Más despacio" · „Langsamer" | spricht langsamer |
| „¿Cómo se dice …?" | erklärt das Wort — meist gleich mit Vorschlag fürs Wörterbuch |
| „Erklär mir das auf Deutsch" | wechselt für diese Erklärung ins Deutsche |

Die vollständige Liste steht auch in der App unter **Einstellungen → Sprachbefehle**.

---

## Wörterbuch und Abfrage

**Aufnehmen** geht auf vier Wegen:

- Auf einen **Vorschlags-Chip** unter Renas Antwort tippen (die grünen Kästchen).
- Auf **＋ Wörterbuch** an einer Sprechblase tippen — dort kannst du einzelne Wörter aus dem
  Satz antippen, statt sie abzutippen.
- Per **Sprachbefehl** („merk dir das").
- Von Hand über **＋ Neu** im Wörterbuch. Lass Deutsch ruhig leer und tipp auf
  **✨ Rena ergänzen lassen** — sie füllt Übersetzung, Beispielsatz und Anmerkung.

**Abfragen** ebenfalls auf zwei Arten:

- **Mit Rena, freihändig:** im Gespräch auf 🎯 tippen (oder „frag mich ab" sagen).
  Sie stellt Fragen, bewertet deine Antworten und der Lernstand wandert automatisch mit.
- **Still mit Karteikarten:** Reiter **Abfrage**. Richtig beantwortet rutscht eine Karte ein
  Fach höher (1 → 3 → 7 → 21 → 60 Tage), falsch zurück auf Fach 1.

Über **Einstellungen → Sichern** exportierst du alles als JSON (Sicherungskopie) oder als
CSV für Excel oder Anki.

---

## Wo liegen deine Daten?

- **Wörterbuch, Gesprächsverlauf und Einstellungen** liegen ausschließlich im Speicher deines
  iPhones (`localStorage`). Es gibt keinen Server, kein Konto, kein Tracking.
- **Die API-Schlüssel** werden nur lokal gespeichert und gehen ausschließlich an den jeweils gewählten Anbieter.
- **Sprachaufnahmen** gehen direkt von deinem iPhone an den gewählten Anbieter und werden
  nirgends zwischengespeichert. Was der Anbieter damit macht, ist unterschiedlich: **Groq**
  trainiert laut AGB nicht auf deinen Eingaben, **Google** wertet sie im Gratis-Tarif in der
  Regel zur Modellverbesserung aus. Sprich im Zweifel nichts ins Mikrofon, was vertraulich
  bleiben soll.
- Löschst du die Web-App vom Home-Bildschirm, ist auch das Wörterbuch weg. **Vorher sichern.**

---

## Wenn etwas klemmt

| Problem | Ursache und Abhilfe |
|---|---|
| Mikrofon startet nicht | Nur über HTTPS möglich. Adresse muss mit `https://` beginnen. Zugriff in iPhone-Einstellungen → Safari → Mikrofon erlauben. |
| Pages meldet „not available for private repos" | Repository öffentlich schalten (Weg A) oder auf Cloudflare Pages/Netlify ausweichen (Weg B). |
| Workflow läuft, aber nichts erscheint | **Settings → Pages → Source** muss auf **GitHub Actions** stehen, nicht auf *Deploy from a branch*. |
| Rena antwortet nicht | Kein oder falscher API-Schlüssel. Einstellungen → **⇄ Verbindung testen** sagt dir genau, woran es liegt. |
| „Aus dem Browser nicht erreichbar" | Der Anbieter lässt keine direkten Aufrufe aus dem Browser zu (CORS). Wechsle in den Einstellungen den Anbieter. |
| Google verlangt Gewerbe-Bestätigung | Das ist Googles Standardklausel für Entwickler-APIs. Wenn du sie nicht abgeben willst: Anbieter auf **Mistral** (Verbraucher-AGB) oder **Groq** umstellen. |
| „Gratis-Kontingent aufgebraucht" | Tageslimit erreicht. Später weitermachen oder in den Einstellungen auf **Gemini 2.5 Flash Lite** wechseln. |
| Keine Stimme zu hören | Klingelton-Schalter am iPhone prüfen. Fehlt die Stimme ganz: Bedienungshilfen → Vorlesen → Stimmen → Spanisch laden. |
| Rena unterbricht sich selbst | Einstellungen → **Dazwischenreden erlaubt** ausschalten. Dann pausiert das Mikrofon, während sie spricht. |
| Sie schneidet dich mitten im Satz ab | **Sprechpause bis zur Antwort** erhöhen (z. B. auf 1,5 s). |
| Sie reagiert auf Nebengeräusche | **Empfindlichkeit** erhöhen. |
| Modell nicht gefunden | Einstellungen → **↻ Verfügbare Modelle laden** und eines aus der Liste wählen. |
| Alte Version wird angezeigt | Web-App vom Home-Bildschirm löschen und aus Safari neu hinzufügen. |

---

## Für Entwickler

Kein Build-Schritt, keine Abhängigkeiten — reines ES-Modul-JavaScript.

```bash
# Lokal starten (Mikrofon funktioniert auf localhost auch ohne HTTPS)
python3 -m http.server 8099
# → http://localhost:8099
```

```
index.html              Grundgerüst aller vier Ansichten
manifest.webmanifest    Web-App-Manifest (Home-Bildschirm-Symbol, Vollbild)
sw.js                   Service Worker — App-Hülle offline verfügbar
css/app.css             Gestaltung, hell und dunkel
js/
  app.js                Start und Navigation zwischen den Reitern
  store.js              Persistenz: Einstellungen, Wörterbuch, Verlauf, Leitner-Logik
  persona.js            Renas System-Prompt (bolivianisches Spanisch, Niveau, Abfrage)
  providers/            KI-Anbieter hinter einer gemeinsamen Schnittstelle
    index.js            Verzeichnis, Auswahl, Verbindungstest
    shared.js           Fehler, JSON-Auswertung, Nutzungszähler
    gemini.js           Audio + Antwortschema in einem Aufruf
    openaiCompatible.js Groq und Mistral: Transkription + Chat
  audio.js              Mikrofon, Sprach-/Pausenerkennung, WAV-Kodierung
  vad-worklet.js        AudioWorklet im Audio-Renderthread
  tts.js                Sprachausgabe über die iOS-Stimmen
  views/                conversation · dictionary · quiz · settings · vocabsheet
```

**Wie das Freihand-Mikrofon funktioniert:** `getUserMedia` liefert einen Dauerstrom, ein
AudioWorklet misst blockweise die Lautstärke. Ein gleitendes Grundrauschen bestimmt die
Schwelle, ab der Sprache beginnt; ein Vorlauf-Puffer von 300 ms verhindert abgeschnittene
Satzanfänge. Nach der eingestellten Sprechpause wird die Äußerung auf 16 kHz heruntergerechnet,
als WAV kodiert und an Gemini geschickt — das transkribiert und antwortet in einem Zug.
Deshalb versteht Rena Deutsch und Spanisch gleichermaßen, ohne dass du eine Sprache umstellen musst.
