# NEXUS demo video: 90-second shot list

A screen recording of the Android app (v1.0.1 release APK) with a short voice-over. It shows the
app working with no connection, the connected-notes features, then sync, a conflict and export.

## Before recording

- **Device A** (recorded): a phone or emulator at 1080 × 2400 or similar, light theme, system
  font size default, notifications silenced. Screen record with `adb shell screenrecord` or
  Android Studio's recorder.
- **Device B**: a second emulator or phone, signed in to the same account. It appears only in
  beat 6, as a picture-in-picture or a quick cut.
- Sign in on both devices while online and let them sync. Seed about 15 notes with links between
  them (for example a "Robotics" set: _Sensor fusion_, _PID control_, _State estimation_) so the
  graph has shape. Delete any note called _Kalman filters_.
- Make sure the hosted API is awake (open `/healthz` in a browser a minute before), so the sync
  in beat 5 is quick.
- Turn **airplane mode on** on device A before beat 1. It stays on until beat 5.
- Practise once. Every beat below is one continuous take; cut between beats.

## Shot list

| Time      | Beat                   | What to show and tap                                                                                                                                                                                                                                                                                                          | Voice-over                                                                              |
| --------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 0:00–0:10 | 1. Offline capture     | Pull down the quick settings to show the airplane icon, close them. On **Notes**, tap **New note**, title _Kalman filters_, body `Estimates state from noisy sensors.` Point at the status line **Saved on this device**.                                                                                                     | "NEXUS is a notes app that never waits for the network. I'm in airplane mode."          |
| 0:10–0:25 | 2. Wiki links          | In the body type ` See [[Sensor` and tap **Sensor fusion** in the suggestions. Tap **Preview**, tap the **Sensor fusion** link. On that note, tap the backlinks line (**… notes link here ›**) and show _Kalman filters_ in the list.                                                                                         | "Type two brackets to link notes. Every link shows up as a backlink on the other side." |
| 0:25–0:37 | 3. Graph               | Tap the **Graph** tab. Let the layout settle for a second, pinch to zoom on the Robotics cluster, tap the _Kalman filters_ node to show its preview.                                                                                                                                                                          | "The links become a knowledge graph you can explore."                                   |
| 0:37–0:47 | 4. Search              | Tap the **Search** tab, type `noisy`. Show _Kalman filters_ in the results with its snippet, tap it.                                                                                                                                                                                                                          | "Full-text search runs on the phone, so it works offline too."                          |
| 0:47–1:00 | 5. Airplane edit, sync | In _Kalman filters_ add a line `Used in the drone project.` Show **Offline: changes are saved on this device**. Turn airplane mode off from quick settings. Hold on the status as it goes **Syncing…** then **Synced**.                                                                                                       | "Everything I did offline was queued. When the connection comes back, it syncs."        |
| 1:00–1:20 | 6. Conflict and merge  | Off camera: A in airplane mode edits _Kalman filters_; B edits the same note and syncs. On camera: show B's edit briefly, then turn A's airplane mode off. The conflict banner appears; tap **Resolve**, show **ON SERVER** and **THIS DEVICE** side by side, tap **Merge**, combine the two lines, tap **Save merged note**. | "If two devices edit the same note, nothing is overwritten. I see both and merge them." |
| 1:20–1:30 | 7. Export              | Tap **Settings**, then **Export, Markdown bundle or JSON**. Choose Markdown, tap the start button, wait for **Export ready**, and show the share sheet with the zip.                                                                                                                                                          | "And my notes are always mine: one tap exports everything as Markdown."                 |

End on the share sheet for a beat, or cut to a title card: **NEXUS**, "Your thinking,
connected.", and the GitHub link.

## Notes for the edit

- Keep the voice-over to the lines above; at a calm pace they fill about 60 of the 90 seconds,
  leaving room for the taps to land.
- Add a small on-screen caption for each beat title (for example "Offline", "Conflict").
- If the sync in beat 5 takes longer than three seconds, trim the wait in the edit rather than
  re-recording; say nothing about speed in the voice-over.
- Beat 6 is the one most likely to need a retake. Stage it right before recording: the conflict
  appears only if A's offline edit started from the revision before B's edit.
