#!/usr/bin/env python3
"""Run from the repo root: python3 backend/internal/fbseed/make_world.py "$PWD". Builds backend/internal/fbseed/world.json: the synthetic Facebook world the server seeds itself with.
Everyone here is invented. Avatars are DiceBear cartoons; photos are picsum scenery; videos are CC0 samples."""
import json, sys, urllib.parse

repo = sys.argv[1]
demo = json.load(open(f"{repo}/FacebookClone/Bubbles/Seeds/bubble-demo-world.json"))

def avatar(name):
    return "https://api.dicebear.com/9.x/notionists/png?size=256&backgroundColor=c0aede,b6e3f4,d1d4f9&seed=" + urllib.parse.quote(name)

def photo(seed, w, h):
    return f"https://picsum.photos/seed/{seed}/{w}/{h}"

VIDEOS = [
    "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    "https://www.w3schools.com/html/mov_bbb.mp4",
    "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4",
    "https://www.w3schools.com/html/movie.mp4",
]

personas = []
for p in demo["people"]:
    name = f'{p["first_name"]} {p["last_name"]}'
    personas.append({"id": p["id"], "firstName": p["first_name"], "lastName": p["last_name"], "kind": "person",
                     "avatarUrl": avatar(name), "coverUrl": photo("cover-" + p["id"], 1200, 450), "bio": p["intro"],
                     "city": "San Francisco, California", "work": p["work"]})

extra = [
    ("fb-nina-castillo", "Nina", "Castillo", "Pastry chef", "Oakland, California"),
    ("fb-marcus-bell", "Marcus", "Bell", "Bike mechanic", "San Francisco, California"),
    ("fb-hana-kim", "Hana", "Kim", "Grad student", "Berkeley, California"),
    ("fb-luca-moretti", "Luca", "Moretti", "Sound engineer", "San Francisco, California"),
    ("fb-zoe-patel", "Zoe", "Patel", "Park ranger", "Marin County, California"),
    ("fb-ben-osei", "Ben", "Osei", "High school coach", "Daly City, California"),
    ("fb-ruth-lindqvist", "Ruth", "Lindqvist", "Retired librarian", "Austin, Texas"),
    ("fb-tomas-reyes", "Tomás", "Reyes", "Muralist", "San Francisco, California"),
]
for pid, first, last, work, city in extra:
    personas.append({"id": pid, "firstName": first, "lastName": last, "kind": "person", "avatarUrl": avatar(first + " " + last),
                     "coverUrl": photo("cover-" + pid, 1200, 450), "work": work, "city": city})

pages = [
    ("page-fog-city-coffee", "Fog City Coffee", "Coffee shop"),
    ("page-bay-trails", "Bay Area Trails", "Outdoors club"),
    ("page-mission-bakes", "Mission Bakes", "Bakery"),
    ("page-sf-night-market", "SF Night Market", "Community event"),
]
for pid, name, cat in pages:
    personas.append({"id": pid, "firstName": name, "kind": "page", "category": cat,
                     "avatarUrl": "https://api.dicebear.com/9.x/shapes/png?size=256&seed=" + urllib.parse.quote(name),
                     "coverUrl": photo("cover-" + pid, 1200, 450), "verified": pid == "page-bay-trails"})

def rx(like, love=0, haha=0, wow=0, care=0):
    out = {"like": like}
    for k, v in (("love", love), ("haha", haha), ("wow", wow), ("care", care)):
        if v: out[k] = v
    return out

posts = []
def post(pid, author, text, minutes, **kw):
    d = {"id": pid, "kind": "post", "authorId": author, "text": text, "minutesAgo": minutes}
    d.update(kw)
    posts.append(d)

G = demo["group"]["id"]
for i, p in enumerate(demo["people"]):
    post(f'world-intro-{p["id"]}', p["id"], p["intro"], 150 + i * 410 + (i % 3) * 35, groupId=G, allowsGames=True,
         reactions=rx(12 + i * 3, 4 + i % 4, 1), comments=[{"authorId": demo["people"][(i + 3) % 10]["id"],
         "text": ["Welcome! You'll love it here.", "Count me in!", "Same boat, let's meet up.", "Welcome to the fog!"][i % 4], "minutesAgo": 100 + i * 400}])

post("world-group-laundry", "sf-priya-natarajan", "Quick question for the Noe Valley folks: where do you do laundry? Every laundromat I find either has a line out the door or eats quarters.", 95, groupId=G, reactions=rx(8, 0, 3),
     comments=[{"authorId": "sf-sam-whitfield", "text": "Spin City on 24th. Bring a book.", "minutesAgo": 80}])
post("world-group-beach", "sf-jordan-brooks", "Ocean Beach at 6 a.m. is a different planet. Wetsuit rented, ego not included. Surf lesson volunteers welcome.", 14 * 60, groupId=G,
     media=[{"kind": "photo", "url": photo("world-ocean-beach", 1080, 1080), "aspect": 1}], location="Ocean Beach", reactions=rx(41, 12, 6))
post("world-group-poll", "sf-chloe-nguyen", "Settling a Thursday trivia argument. Which one wins?", 31 * 60, groupId=G,
     poll=[{"id": "fog-weather", "title": "Fog is a weather", "votes": 212}, {"id": "fog-personality", "title": "Fog is a personality", "votes": 187},
           {"id": "karl", "title": "Karl needs a name change", "votes": 93}], reactions=rx(25, 3, 18))
post("world-group-sunset", "sf-sam-whitfield", "Bernal Hill sunset tonight, 6:15 sharp. Bring a layer and a friend. Board game night to follow if it gets cold.", 52 * 60, groupId=G,
     media=[{"kind": "photo", "url": photo("world-bernal-sunset", 1080, 1350), "aspect": 0.8}], reactions=rx(57, 21))

feed = [
    ("fb-p-sourdough", "sf-diego-ramirez", "Loaf number 14. The crumb is finally where I want it. Mission folks, I have two extra if anyone wants one.", 35,
     {"media": [{"kind": "photo", "url": photo("sourdough-14", 1080, 1080), "aspect": 1}], "feeling": "proud", "reactions": rx(64, 22, 2, 5)}),
    ("fb-p-sketch", "sf-aiko-tanaka", "Sunday sketch walk: the painted houses on Steiner. Next week I'm doing North Beach rooftops, join me!", 3 * 60,
     {"media": [{"kind": "photo", "url": photo("aiko-sketch-1", 1080, 1350), "aspect": 0.8}, {"kind": "photo", "url": photo("aiko-sketch-2", 1080, 1080), "aspect": 1}], "reactions": rx(88, 40, 0, 9)}),
    ("fb-p-openmic", "sf-theo-adeyemi", "Played my first SF open mic last night. Nervous for the first song, fine by the third. Thanks to everyone who came out ❤️", 5 * 60,
     {"location": "The Foghorn Room", "reactions": rx(73, 31, 0, 0, 6)}),
    ("fb-p-background-1", "fb-hana-kim", "Finals week. Send snacks.", 7 * 60, {"background": 3, "reactions": rx(19, 2, 11)}),
    ("fb-p-coffee", "page-fog-city-coffee", "New seasonal: maple oat cortado. Free pastry with any drink before 9 a.m. this week.", 9 * 60,
     {"media": [{"kind": "photo", "url": photo("fog-coffee-cortado", 1200, 900), "aspect": 1.333}], "reactions": rx(140, 33)}),
    ("fb-p-bike", "fb-marcus-bell", "PSA: the bike lane on Valencia is repainted and it looks great. Ride safe, everyone.", 11 * 60, {"reactions": rx(45, 3)}),
    ("fb-p-hike", "page-bay-trails", "Saturday group hike: Lands End to Sutro Baths, 3.4 miles, easy pace. Meet at the Merrie Way lot at 9.", 13 * 60,
     {"media": [{"kind": "photo", "url": photo("lands-end-trail", 1200, 800), "aspect": 1.5}], "reactions": rx(210, 60, 0, 12)}),
    ("fb-p-swim", "sf-lena-fischer", "Aquatic Park, 13°C. My Berlin friends think I've lost it. Maybe I have.", 18 * 60,
     {"feeling": "determined", "location": "Aquatic Park", "reactions": rx(52, 8, 14, 9)}),
    ("fb-p-background-2", "fb-ben-osei", "Our team won the league final! So proud of these kids.", 20 * 60, {"background": 7, "reactions": rx(130, 77, 0, 4, 10)}),
    ("fb-p-mural", "fb-tomas-reyes", "Finished the Balmy Alley panel. Three weeks, two rain delays, one very patient neighbor.", 26 * 60,
     {"media": [{"kind": "photo", "url": photo("balmy-mural", 1080, 1350), "aspect": 0.8}], "reactions": rx(310, 120, 0, 40)}),
    ("fb-p-soccer", "sf-omar-haddad", "Pickup soccer at Potrero rec, Sundays at 10. We need two more for even sides.", 30 * 60, {"reactions": rx(22, 1)}),
    ("fb-p-bakes", "page-mission-bakes", "Conchas are back this weekend. Pre-orders open Friday.", 34 * 60,
     {"media": [{"kind": "photo", "url": photo("mission-conchas", 1200, 1200), "aspect": 1}], "sponsored": True, "reactions": rx(95, 30)}),
    ("fb-p-library", "fb-ruth-lindqvist", "Forty years of library cards, finally framed. Never too late to start a collection.", 40 * 60,
     {"media": [{"kind": "photo", "url": photo("library-cards", 1200, 900), "aspect": 1.333}], "reactions": rx(66, 41)}),
    ("fb-p-ranger", "fb-zoe-patel", "Fog rolling over the Marin Headlands this morning. Best office in the world.", 46 * 60,
     {"media": [{"kind": "photo", "url": photo("marin-fog", 1200, 800), "aspect": 1.5}], "reactions": rx(180, 70, 0, 25)}),
    ("fb-p-market", "page-sf-night-market", "Night Market returns Friday: 40 food stalls, live music and a dumpling-eating contest. Who's in?", 55 * 60,
     {"reactions": rx(260, 45, 8)}),
    ("fb-p-pastry", "fb-nina-castillo", "Testing a black sesame croissant. Brutal honesty requested from anyone near Lake Merritt tomorrow.", 60 * 60,
     {"media": [{"kind": "photo", "url": photo("sesame-croissant", 1080, 1080), "aspect": 1}], "reactions": rx(48, 19)}),
    ("fb-p-sound", "fb-luca-moretti", "Mixed a live album this week. Ears ringing, heart full.", 70 * 60, {"feeling": "thankful", "reactions": rx(33, 7)}),
    ("fb-p-trivia", "sf-chloe-nguyen", "Our trivia team placed second! The tiebreaker was about sea lions at Pier 39 and we choked.", 80 * 60, {"reactions": rx(39, 4, 21)}),
    ("fb-p-life-maya", "sf-maya-okafor", "First week at the lab done. Here's to new beginnings.", 96 * 60,
     {"lifeEvent": "Started a new job at Bayfield Biosciences", "reactions": rx(102, 64, 0, 0, 12)}),
    ("fb-p-sunset-2", "sf-sam-whitfield", "Another one from Bernal. I'll stop posting these when they stop being this good.", 110 * 60,
     {"media": [{"kind": "photo", "url": photo("bernal-sunset-2", 1200, 800), "aspect": 1.5}], "reactions": rx(77, 30)}),
    ("fb-p-chicken", "sf-jordan-brooks", "Fried chicken Friday at Salt & Fennel. Come say hi to the line cooks.", 130 * 60, {"reactions": rx(58, 12)}),
    ("fb-p-background-3", "fb-marcus-bell", "Who else is riding to Sausalito this weekend?", 150 * 60, {"background": 1, "reactions": rx(16)}),
]
for pid, author, text, minutes, kw in feed:
    post(pid, author, text, minutes, **kw)

# a couple of comments on the busier ones
comment_lines = ["This is great!", "Love this.", "Where is this?", "Saving for later.", "Count me in!", "So good 😍", "Congrats!!"]
commenters = [p["id"] for p in personas if p["kind"] == "person"]
for i, p in enumerate(posts):
    if "comments" in p or i % 2:
        continue
    p["comments"] = [{"authorId": commenters[(i * 3 + j) % len(commenters)], "text": comment_lines[(i + j) % len(comment_lines)],
                      "minutesAgo": max(1, p["minutesAgo"] - 10 * (j + 1))} for j in range(1 + i % 3) if commenters[(i * 3 + j) % len(commenters)] != p["authorId"]]

reels = []
reel_lines = [
    ("fb-r-1", "fb-tomas-reyes", "Timelapse: three weeks of mural in 20 seconds 🎨", "Original audio · Tomás Reyes"),
    ("fb-r-2", "page-bay-trails", "Lands End at golden hour. Tag your hiking buddy.", "Trail Mix · Bay Area Trails"),
    ("fb-r-3", "sf-diego-ramirez", "How I shape a batard (badly, then better)", "Original audio · Diego Ramírez"),
    ("fb-r-4", "sf-theo-adeyemi", "Thirty seconds of keys from Saturday's set", "Foghorn Blues · Theo Adeyemi"),
    ("fb-r-5", "fb-zoe-patel", "Spotted: a very confident coyote at Crissy Field", "Original audio · Zoe Patel"),
    ("fb-r-6", "page-sf-night-market", "Dumpling contest highlights 🥟", "Night Market Mix"),
    ("fb-r-7", "sf-lena-fischer", "Cold water swim, day 30", "Original audio · Lena Fischer"),
    ("fb-r-8", "fb-ben-osei", "Final whistle! League champions 🏆", "Original audio · Ben Osei"),
]
for i, (rid, author, text, audio) in enumerate(reels_src := reel_lines):
    reels.append({"id": rid, "kind": "reel", "authorId": author, "text": text, "audio": audio, "minutesAgo": 60 + i * 340,
                  "media": [{"kind": "video", "url": photo(rid, 720, 1280), "videoUrl": VIDEOS[i % len(VIDEOS)], "aspect": 0.5625, "duration": 12 + i * 4}],
                  "views": 2400 + i * 31700, "shares": 12 + i * 9, "reactions": rx(300 + i * 140, 90 + i * 20, 10 + i)})

stories = []
story_people = ["sf-diego-ramirez", "sf-aiko-tanaka", "sf-theo-adeyemi", "sf-maya-okafor", "fb-tomas-reyes", "fb-zoe-patel",
                "sf-lena-fischer", "fb-nina-castillo", "page-fog-city-coffee", "sf-chloe-nguyen"]
captions = ["Morning views ☀️", "", "Guess where I am", "", "Fog check", "Best day", ""]
texts = ["Who's up for tacos tonight?", "Day 30 of cold swims 🥶", "New sketchbook, who dis"]
for i, who in enumerate(story_people):
    for j in range(1 + i % 3):
        sid = f"fb-s-{i}-{j}"
        minutes = 30 + i * 70 - j * 15
        if (i + j) % 4 == 3:
            stories.append({"id": sid, "authorId": who, "text": texts[(i + j) % len(texts)], "background": (i * 3 + j) % 12, "minutesAgo": minutes})
        else:
            stories.append({"id": sid, "authorId": who, "media": {"kind": "photo", "url": photo(f"story-{who}-{j}", 720, 1280), "aspect": 0.5625},
                            "caption": captions[(i + j) % len(captions)], "minutesAgo": minutes})

threads = [
    {"id": "dm-diego", "members": ["@me", "sf-diego-ramirez"], "theme": "0A7CFF", "messages": [
        ("sf-diego-ramirez", "Hey! Saw your post in New in SF. Welcome to the Mission side of things", 300),
        ("@me", "Thanks! Still figuring out which hill is which", 290),
        ("sf-diego-ramirez", "Ha. Come by Saturday, I'm giving away a loaf", 285),
        ("@me", "I'm there 🍞", 280),
        ("sf-diego-ramirez", "Bring a tote bag, it's a big one", 12)]},
    {"id": "dm-aiko", "members": ["@me", "sf-aiko-tanaka"], "theme": "7646FF", "emoji": "❤️", "messages": [
        ("sf-aiko-tanaka", "Sketch walk Sunday at 10?", 600),
        ("@me", "Yes! Where do we meet?", 590),
        ("sf-aiko-tanaka", "Washington Square, by the church steps", 580),
        ("sf-aiko-tanaka", "I'll bring extra pencils", 45)]},
    {"id": "dm-theo", "members": ["@me", "sf-theo-adeyemi"], "theme": "00B2FF", "messages": [
        ("@me", "That set was so good last night", 900),
        ("sf-theo-adeyemi", "Cheers! Second song nearly fell apart haha", 880),
        ("sf-theo-adeyemi", "Next one is the 21st, I'll save you a spot", 120)]},
    {"id": "dm-maya", "members": ["@me", "sf-maya-okafor"], "theme": "0ACF83", "messages": [
        ("sf-maya-okafor", "Running Lands End Saturday at 8. Want in?", 1400),
        ("@me", "How fast are we talking", 1390),
        ("sf-maya-okafor", "Conversational pace, promise", 1385)]},
    {"id": "dm-hana", "members": ["@me", "fb-hana-kim"], "theme": "8C4FFF", "messages": [
        ("fb-hana-kim", "Are you still coming to the study group?", 2900),
        ("@me", "Yes, running 10 min late", 2880),
        ("fb-hana-kim", "👍", 2870)]},
    {"id": "dm-marcus", "members": ["@me", "fb-marcus-bell"], "theme": "FF7E29", "messages": [
        ("fb-marcus-bell", "Your bike is ready for pickup", 4300),
        ("@me", "Amazing, thank you! Coming by after work", 4200)]},
    {"id": "gc-newinsf-crew", "members": ["@me", "sf-diego-ramirez", "sf-aiko-tanaka", "sf-theo-adeyemi", "sf-chloe-nguyen"], "name": "New in SF crew 🌁", "theme": "0A7CFF", "messages": [
        ("sf-chloe-nguyen", "Trivia Thursday, who's in?", 200),
        ("sf-theo-adeyemi", "Me, if I'm not at a gig", 190),
        ("@me", "In!", 185),
        ("sf-diego-ramirez", "I'll bring snacks", 30),
        ("sf-aiko-tanaka", "We need a team name", 8)]},
    {"id": "gc-picnic", "members": ["@me", "sf-maya-okafor", "sf-sam-whitfield", "sf-priya-natarajan"], "name": "Picnic planners 🧺", "theme": "0ACF83", "messages": [
        ("sf-sam-whitfield", "I can bring a frisbee and a speaker", 700),
        ("sf-priya-natarajan", "I'll do lemonade", 690),
        ("sf-maya-okafor", "Blankets covered", 650),
        ("@me", "I'll grab sandwiches", 640)]},
]
out_threads = []
for t in threads:
    t2 = {k: v for k, v in t.items() if k != "messages"}
    t2["messages"] = [{"senderId": s, "text": txt, "minutesAgo": m} for s, txt, m in t["messages"]]
    out_threads.append(t2)

world = {"_note": "Synthetic demo world for the Facebook surfaces. Every person, Page, post and chat here is invented. Built by make_world.py.",
         "personas": personas, "posts": posts + reels, "stories": stories, "threads": out_threads}
json.dump(world, open(f"{repo}/backend/internal/fbseed/world.json", "w"), indent=1, ensure_ascii=False)
print(len(personas), "personas", len(posts), "posts", len(reels), "reels", len(stories), "stories", len(out_threads), "threads")
