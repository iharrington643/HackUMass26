# Author : Rayne Allyn
# Email  : vixenthefox@proton.me
# Date   : 15, Nov. 2026.
# Note   : Uses work from Perron, D. (2018). This program was created for HackUMass 2026.

# This program is DESIGNED to be initialized as a JS child process, all outputs are prints so that JS can catch the standard out.

from gpiozero import Button
from time import sleep
import MFRC522 #Credit to Daniel Perron, used under the GNU Lesser General Public License. Utilized for the MFRC522 RFID Reader.
import signal

## Initialize buttons
# Start: Pin 23
start = Button(23, bounce_time=0.05)
def on_start():
    print("start")
# Dose UP: Pin 18
doseup = Button(18, bounce_time=0.05)
def on_doseup():
    print("dose up")
# Dose DOWN: Pin 17
dosedown = Button(17, bounce_time=0.05)
def on_dosedown():
    print("dose down")
# Time BACKWARD: Pin 15
timeback = Button(15)
# Time FORWARD: Pin 27
timeforward = Button(27)
# Pause SWITCH: Pin 14
pauseswitch = Button(14, bounce_time=0.05)
def on_pause():
    print("pause")
def on_unpause():
    print("resume")

## Initialize RFID reader:
# Changes made by Rayne: Removed welcome message, removed card detected message, removed else statement for UID, Relocated listening loop to the next section.
# Most all of the python written here was written by Perron, D. in 2018 and can be found at this link: https://github.com/danjperron/MFRC522-python/tree/master

continue_reading = True

# function to read uid and convert it to a string

def uidToString(uid):
    mystring = ""
    for i in uid:
        mystring = format(i, '02X') + mystring
    return mystring

# Capture SIGINT for cleanup when the script is aborted
def end_read(signal, frame):
    global continue_reading
    continue_reading = False

# Hook the SIGINT
signal.signal(signal.SIGINT, end_read)

# Create an object of the class MFRC522
MIFAREReader = MFRC522.MFRC522()

## Listen for Inputs:
start.when_pressed = on_start
doseup.when_pressed = on_doseup
dosedown.when_pressed = on_dosedown

# Pausing/Playing the simulation:

pauseswitch.when_pressed = on_pause
pauseswitch.when_released = on_unpause


#RFID listen loop and time scrolling:
while continue_reading:

    try:
        if timeback.is_pressed and pauseswitch.is_pressed:
            print("time back")
        if timeforward.is_pressed and pauseswitch.is_pressed:
            print("time forward")
        sleep(0.1)  # Small delay
    finally:
        # Scan for cards
        (status, TagType) = MIFAREReader.MFRC522_Request(MIFAREReader.PICC_REQIDL)

        # If a card is found
        if status == MIFAREReader.MI_OK:

            # Get the UID of the card
            (status, uid) = MIFAREReader.MFRC522_SelectTagSN()
            # If we have the UID, continue
            if status == MIFAREReader.MI_OK:
                print("Treatment: %s" % uidToString(uid))

