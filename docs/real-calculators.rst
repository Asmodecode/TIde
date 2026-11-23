Real calculators
================

**Real calculator** in the calculator panel's model menu, or **File → Connect a calculator…**,
opens one popup that lists every way TIde can reach a calculator, whatever the cable.

.. list-table::
   :header-rows: 1
   :widths: 25 40 35

   * - Cable
     - Calculators
     - Through
   * - USB
     - TI-84 Plus CE, 84 Plus, 83 Premium CE and others with a USB port
     - TILP's libraries (WebTILP)
   * - SilverLink
     - Calculators with the round 2.5 mm link port
     - TILP's libraries (WebTILP)
   * - TI-Graph Link (serial)
     - TI-84 Plus, 84 Plus SE, 83 Plus, 83 Plus SE, 83, 82, 73
     - TIde's own serial link

.. note::

   On Windows, USB needs the WinUSB driver for the calculator or cable: install it with
   `Zadig <https://zadig.akeo.ie>`_, as for TILP.

Serial cables
-------------

- **It finds them:** leave a serial port's calculator on **Find out**, and TIde asks it which it is.
  **Find my calculator** tries every serial port.
- **It runs programs:** Run sends the program and starts it, pressing the calculator's keys over the
  cable. (Not on the TI-82, which can't be controlled over the cable.)
- **It recovers:** a send that gets no answer is tried again, and a damaged packet is asked for again.

The TI-84 Evo
-------------

TIde recognizes a TI-84 Evo over USB, but can't send to it yet, as its link protocol isn't published.
Use TI Connect Evo until then.
