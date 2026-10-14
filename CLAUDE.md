# Notes for working on CardDex

- Every user-facing change: add a plain-English item to `www/changelog.json`
  (newest entry first; new `id` for each update the user will receive). The app
  shows it as "What's new" after updating, and the APK release notes are built
  from it (`build/release_notes.py`).
- `build/native-api.txt`: bump only when the Android side changes (new APK needed).
