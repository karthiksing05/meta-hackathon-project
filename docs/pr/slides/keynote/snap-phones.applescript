-- Snaps Live Video boxes into place. Every phone screen is 462x1000 (the iPhone feed aspect, 0.462).
-- Slide 10 (Demo): the first live box fills the big phone on the right.
-- Slide 11 (best of 5): 1st live box -> Karthik's blue phone, 2nd -> Bayan's violet phone.
tell application "Keynote"
	set d to document "Muse Curios pitch.key"
	set n8 to 0
	repeat with itm in (get iWork items of slide 10 of d)
		if class of itm is not image then
			set n8 to n8 + 1
			if n8 is 1 then
				set width of itm to 462
				set height of itm to 1000
				set position of itm to {1334, 40}
			end if
		end if
	end repeat
	set n to 0
	repeat with itm in (get iWork items of slide 11 of d)
		if class of itm is not image then
			set n to n + 1
			if n ≤ 2 then
				set width of itm to 462
				set height of itm to 1000
				if n is 1 then
					set position of itm to {810, 40}
				else
					set position of itm to {1404, 40}
				end if
			end if
		end if
	end repeat
	save d
	return "demo slide: " & n8 & " live box(es); collaboration slide: " & n & " live box(es)"
end tell
