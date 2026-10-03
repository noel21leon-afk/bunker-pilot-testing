# Bunker & ROB Planner PWA

Offline-first Progressive Web App derived from the supplied legacy Excel workbook **BUNKER CALCULATION SHEET.xls**.

## What the workbook actually does

The main workbook sheets contain:
- Voyage route rows with port name, distance from previous port, estimated speed, steaming days, at-sea consumption, port-stay days, in-port consumption and estimated date.
- Fuel ROB tracking for VLSFO and LSMGO.
- Tank-level consumption using active-tank / automatic switching behavior across storage tanks.
- Fuel tank support values such as FO settling, FO service, boiler FO service, overflow and DO service tank ROB.
- Bunker quantity input, post-voyage ROB, unpumpable quantity, sea-margin calculations and storage-capacity percentage checks.
- Cylinder-oil present ROB and cylinder-oil daily consumption.
- Separate test sheets describing a two-tank automatic-switch formula: consume the active tank until zero, then switch to the other tank; tanks may be refilled independently.

The supplied workbook does **not** contain a clearly defined ME system-oil or GE system-oil ROB module. Those are added as explicit app inventory categories and their rates are user inputs rather than assumed values.

## Core calculation behavior implemented

For every route stop:
1. Sea days = distance NM / speed kn / 24.
2. Sea consumption = sea days × at-sea daily rate.
3. Port consumption = port-stay days × in-port daily rate.
4. Arrival time = previous departure + sea passage time.
5. Departure time = arrival + port-stay duration.
6. Active fuel tanks are consumed in sequence and switch only when the current tank is exhausted.
7. Bunkering is credited to departure ROB and is distributed only within tank free capacity.
8. Reserve quantity = reserve days × reserve-rate basis/day.
9. Bunker shortfall is calculated as the additional amount needed at the current port to cover remaining planned consumption + selected reserve + configured unpumpable quantity, less current projected ROB and future planned bunker quantities.
10. Negative ROB and overfill are not silently accepted; they produce planning alerts.

## Important inputs added beyond the workbook

- Voyage start UTC date/time.
- Port UTC offset for local ETA/ETD presentation.
- Explicit tank capacity, current ROB, unpumpable quantity and consumable/support classification.
- Explicit bunker event quantity and tank allocation, with optional automatic allocation by free capacity.
- ME system oil and GE system oil inventory and daily usage/makeup rates.
- Separate reserve days and reserve-rate basis per product.
- Notes/remarks per port.

For a production version, additional fields worth adding are bunker transfer start/end time, BDN quantity/density/temperature, ROB measurement source and timestamp, fuel density conversion basis, changeover/operating mode by leg, maneuvering/idle consumption, weather/current allowance, and company-specific minimum service/settling tank limits.

## Run

Serve this directory from localhost or HTTPS, for example with any simple static web server. A service worker cannot be installed reliably from a `file://` URL.

The app has no external runtime dependencies.


## UI / usability upgrade

- Persistent sidebar navigation on desktop; compact always-visible navigation rail on phones.
- Guided explanation text for every major input variable.
- Add Tank uses a default name based on the selected group, e.g. `Fuel Oil (VLSFO/HFO) Tank 1` or `Cylinder Oil Tank 1`.
- Tank consumption sequence can be selected directly and moved earlier/later with ↑ / ↓ controls.
- Every tank shows a present-volume bar with utilization and overfill warning states.
- Tank and route deletion requires confirmation before removal.
- Dashboard includes manual vessel present position plus calculated planned voyage status and a route summary of succeeding ports, port stays and ETA/ETD.
- Everything recalculates live as inputs change; there is no Recalculate button.
- Tapping a planning alert jumps to the field that causes it and shows how to correct it (the guide confirms when the alert clears).
- Voyages are saved under a name on the device (Results tab). Excel/JSON export and import were removed in v1.16.
