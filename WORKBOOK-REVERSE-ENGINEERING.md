# Reverse Engineering Notes — BUNKER CALCULATION SHEET.xls

## 1. Workbook structure found

The supplied legacy Excel workbook is an OLE/BIFF `.xls` workbook with 8 worksheets. Two worksheets are full voyage/bunker sheets and the remaining sheets are tank-tracking prototypes/examples.

### Main voyage sheets

1. **V071 Bunker Cal** — older/alternate voyage calculator.
   - 39-row used range and about 42 columns.
   - 334 formula cells detected.
   - Contains port-by-port voyage planning, VLSFO + LSMGO ROB, tank tracking, cylinder-oil ROB and bunker requirement summary.

2. **Bunker CalCUALTION SHEET** — newer/main voyage calculator.
   - 56-row used range and about 54 columns.
   - 1,021 formula cells detected.
   - More detailed tank-level tracking than the older sheet.

### Supporting/test worksheets

3. **Sheet3** — two-tank active-tank consumption tracker with P/S tank switching.
4. **Sheet1** — simpler two-tank tracker.
5. **Sheet2** — dynamic two-tank tracker plus embedded written instructions for the formulas.
6. **Sheet4** — another tank tracking example.
7. **Sheet5** — another active-tank example.
8. **Sheet6** — another two-tank example.

These supporting sheets are useful for understanding the intended switching algorithm, but they should not be treated as production logic because some example scenarios produce negative tank balances.

## 2. Main voyage input model

The core voyage table uses these fields:

- Port / voyage location
- Distance from previous port (NM)
- Estimated speed (knots)
- Steaming days
- At-sea daily consumption for LSMGO and VLSFO
- Port stay (days)
- In-port daily consumption for LSMGO and VLSFO
- In-port consumption quantities
- Bunker / requirement quantities
- ROB by fuel
- Tank-level ROB
- Estimated date

The workbook's basic time/fuel equations are consistent with:

**Steaming days = Distance NM / Speed kn / 24**

**Sea consumption = Steaming days × at-sea daily consumption**

**Port consumption = Port-stay days × in-port daily consumption**

The main sheet therefore has enough information to reproduce the basic voyage fuel forecast.

## 3. ROB architecture actually present

### VLSFO / fuel-oil side

The main sheet tracks two pairs of storage tanks and several supporting tanks. The column pattern is:

- 1P: start / consumption / end
- 1S: start / consumption / end
- FO settling tank
- FO service tank
- Boiler FO service tank
- Overflow tank

A representative initial VLSFO total in the supplied main sheet is approximately:

406.6 + 52.4 + 8.8 + 14.1 + 1.0 + 1.0 = **483.9 MT**

This exactly matches the displayed VLSFO total ROB, showing that the workbook's fuel ROB is not limited to the active storage pair; support-tank ROB is included in total ROB.

### LSMGO / diesel-oil side

The main sheet tracks:

- DO / LSMGO tank 1P: start / consumption / end
- DO / LSMGO tank 1S: start / consumption / end
- DO service tank

A representative initial LSMGO total is approximately:

60.4 + 32.4 + 9.6 = **102.4 MT**

Again this matches the displayed total ROB.

## 4. Bunkering behavior

The main sheet allows bunker quantities to be assigned into specific storage tanks. Example data in the supplied workbook shows a planned Singapore bunker with quantities placed into individual tank positions rather than only one aggregate ROB number.

That means the PWA should not use only:

> "Bunker quantity = X MT"

It should support:

> **Fuel type → total bunker quantity → tank-by-tank allocation → capacity validation → new tank ROB**

The app therefore supports both manual tank allocation and an explicit auto-allocation-by-free-capacity option.

## 5. Active-tank logic

The supporting sheets explicitly describe the intended algorithm.

For a two-tank group:

- Only one tank is active at a time.
- Consume the active tank first.
- If its balance reaches zero, automatically switch to the other tank.
- If the active tank becomes insufficient for the day's demand, the remaining demand can be drawn from the other tank.
- A previously empty tank can be refilled without automatically making it active again.
- Both tanks can be refilled independently.

The documented example logic is equivalent to the following conceptual formulas:

```text
Consumed from A = IF(A is active, MIN(daily consumption, previous A balance), 0)

Balance A = previous A balance - consumed from A + A refill

Consumed from B =
    IF(B is active,
       MIN(daily consumption, previous B balance),
       IF(previous A balance < daily consumption,
          daily consumption - previous A balance,
          0))

Balance B = previous B balance - consumed from B + B refill

Active tank =
    if A was active and A will reach zero -> B
    if B was active and B will reach zero -> A
    otherwise keep current active tank
```

The PWA generalizes this to an ordered list of tanks and prevents a negative balance from being carried forward. When all configured tanks are exhausted, the app raises a shortage alert.

## 6. Voyage date logic and why ETA/ETD must be separated

The workbook has one **EST DATE** field rather than explicit ETA and ETD fields. Its rows mix actual port names and sailing-leg descriptions, for example `KANDLA`, `KANDLA-GOA`, `GOA`, `GOA-SINGAPORE`.

Because port-stay time is represented inside the same row structure, the displayed date is not a clean dedicated arrival timestamp for every port.

The PWA replaces this ambiguity with two explicit timestamps:

- **ETA** = previous port departure + sea passage time
- **ETD** = ETA + port-stay duration

Each port may also have a UTC offset so the same schedule can be viewed in both UTC and local port time.

## 7. Cylinder oil logic actually present

The workbook explicitly contains:

- Cylinder Oil Present ROB
- Cylinder Oil Consumption per Day
- Cylinder Oil Total ROB

A representative example in the main sheet is approximately:

Present ROB = 13,673 L

Daily cylinder-oil consumption = 205 L/day

The displayed total ROB after the voyage is consistent with consumption being applied to **sea days**, not port-stay days.

The app therefore models cylinder oil separately from bunker fuel, with its own unit and daily rates.

## 8. Lubricants missing from the workbook

A search of the workbook text/labels found no dedicated modules for:

- ME System Oil ROB
- GE System Oil ROB

These were explicitly requested for the PWA and are therefore new data categories rather than copied workbook logic.

To avoid inventing vessel-specific consumption, the PWA exposes their rates and tank capacities as user inputs.

## 9. Safety margin / reserve behavior

The workbook contains:

- `REQ SEA MARGIN`
- `Sea Margin`
- unpumpable quantity
- M/E consumption reference at an MCR-related speed

The exact reserve formula is not sufficiently self-explanatory from the labels alone. The PWA therefore makes the reserve basis explicit:

**Reserve quantity = Reserve days × Reserve-rate basis/day**

This lets the Chief Engineer choose the actual company/vessel reserve rule instead of hiding it inside an opaque formula.

The PWA also separates:

- current/projected ROB
- unpumpable quantity
- reserve quantity
- effective margin days
- calculated bunker shortfall

## 10. Capacity calculation issue improved in the PWA

The workbook has a field labeled `% Volume After Bunkering`, but the displayed percentage corresponds to the post-consumption ROB relative to total tank capacity in the observed example, not a clearly isolated "immediately after bunkering" state.

The PWA removes that ambiguity and reports:

- tank capacity
- ROB at arrival
- ROB at departure
- bunker quantity
- free capacity
- projected utilization percentage

## 11. Additional important inputs not clearly present in the workbook

### Planning inputs

- Voyage start date/time
- UTC offset / time-zone handling per port
- Port arrival and departure as separate events
- Exact port stay duration
- Speed by leg
- Optional maneuvering / slow-steaming / idle consumption
- Optional weather/current allowance
- Optional delay/contingency days

### Fuel and tank data

- Exact fuel grade name
- Tank capacity for every tank
- Present ROB for every tank
- Unpumpable quantity for every tank
- Active tank / consumption sequence
- Tank category: storage, service, settling, support
- Bunker amount allocated to each tank
- Bunker completion time

### Bunkering/measurement fields worth adding in a later operational version

- Bunker Delivery Note (BDN) number
- Bunker delivery date/time
- Fuel received in metric tonnes
- Density at 15°C
- Fuel temperature
- Sulphur content
- Viscosity / other quality fields as required by the ship's procedures
- ROB measurement method and timestamp

These additions are consistent with IMO fuel-consumption and bunker-record data structures. IMO DCS guidance includes distance travelled, hours underway, fuel-oil type, quantity and measurement method; IMO Compendium data fields also include BDN identifier/date-time, received mass, density, sulphur content and other bunker particulars.

## 12. Important output data the PWA should provide

For each port:

- ETA local
- ETA UTC
- ETD local
- ETD UTC
- distance and speed
- sea days
- port stay days
- fuel consumption at sea
- fuel consumption in port
- ROB on arrival
- ROB on departure
- bunker received
- calculated bunker shortfall
- reserve quantity
- margin in days
- tank-by-tank ROB after the event
- tank utilization
- alerts

For the voyage summary:

- total sea days
- total port days
- total voyage duration
- total consumption per fuel
- total consumption per lubricant
- total planned bunkers
- final projected ROB
- days of fuel margin
- first/next shortage event, if any
- tank capacity utilization

## 13. Deliberate safety/quality improvements in the PWA

The legacy test sheets contain sample scenarios where tank balances become negative. The PWA does not copy that behavior.

Instead it:

- switches tanks automatically within the consumption sequence;
- never silently carries a negative ROB;
- stops when all configured consumable tanks are exhausted;
- flags shortages;
- prevents bunker allocations from exceeding tank capacity;
- distinguishes support/service tanks from automatically consumed storage tanks;
- makes reserve rules visible and editable.

## 14. External reference checks used for the "missing inputs" review

IMO DCS guidance identifies distance travelled, hours underway, fuel-oil type, quantity and consumption measurement method as relevant ship fuel-consumption data. citeturn453790search23turn453790search0

IMO bunker/electronic-data fields also identify BDN number, bunker delivery date/time, received amount, density at 15°C, sulphur content and related bunker particulars as useful structured fields. citeturn453790search2turn453790search3

These are recommended as **future operational/record fields**, not as hidden assumptions in the calculator.
