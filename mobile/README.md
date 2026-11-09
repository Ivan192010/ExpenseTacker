# CoupleCount mobile (Part 2)

Expo SDK 58, with Expo Router, NativeWind 4, TanStack Query 5, Zustand 5 and Axios. It talks to the
FastAPI backend in `../backend`.

## Screens

| Route | What |
|---|---|
| `login` | Email and password. If the `EXPO_PUBLIC_USER_*` variables are set, it shows a "Who is using this phone?" toggle. Links this phone to the account (device binding). |
| `(tabs)/index` | Month dashboard: switch months with ‹ › (tap the title for other ledgers), each person's money left, income, spending and card outflow, who owes whom, and the expense list with installment badges. |
| `(tabs)/balances` | Balance bars in the Tricount style, "Partner owes you $X", and **Settle up / Mark as paid**. |
| `(tabs)/installments` | Hub: remaining debt, how much is committed next month, totals per person, and every plan. |
| `installments/[id]` | Payment schedule, Pay off early, Cancel remaining, Delete plan, Rename. |
| `expense/new`, `expense/[id]` | Add or edit an entry: Expense, Income or Transfer; paid by; for whom; Equal, Amounts, % or Shares; presets; MSI installments. |
| `income` | Monthly salary and extras for both people, with an option to apply the change to later months. |
| `ledgers` | Jump to a month, or create or open an event ledger such as Vacation. |
| `(tabs)/settings` | Lock now, linked phones (unlink), sign out. |

`src/components/BiometricAuthGate.tsx` wraps the whole app. It asks for the fingerprint, or the phone
PIN as a fallback, when the app opens and every time it comes back from the background. While the app
is in the background, the lock screen covers your data, so the recent-apps preview shows nothing.

## Run in development

```bash
npm install
cp .env.example .env        # set EXPO_PUBLIC_API_URL
npx expo start              # press "a" for an Android emulator, or scan with Expo Go
```

The Android emulator reaches your PC's `localhost` at `http://10.0.2.2:8000`. A real phone needs your
PC's LAN IP, or the Railway URL.

## Build the APK (EAS)

1. Put your Railway URL in `eas.json` for both the `preview` and `production` profiles:
   `"EXPO_PUBLIC_API_URL": "https://<your-service>.up.railway.app"`
2. Run these once: `npx eas-cli@latest login`, then `npx eas-cli@latest init` to create the Expo project
   and write its id into app.json.
3. Build: `npm run build:apk`, which runs `eas build -p android --profile preview`.
4. When the build finishes, EAS shows a link and a QR code. Open it on both phones and install the
   `.apk`. You may need to allow installs from your browser.

Both profiles use `"buildType": "apk"`, so you never get an `.aab` (the Play Store format). Use
`production` for a release build with an auto-incremented version code.
