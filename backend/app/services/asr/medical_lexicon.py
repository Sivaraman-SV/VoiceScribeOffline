"""Directory of Indian Clinical Pharmacopeia, Medications, and Medical Terms.

Maintains comprehensive vocabularies for outpatient consultations, Indian pharmaceutical
brand names, OTC formulations, symptoms, vitals, and diagnostic investigations.
Used for prompt biasing, entity extraction, and phonetic acoustic normalisation.
"""

from __future__ import annotations

import re
from typing import Final

# --------------------------------------------------------------------------
# 1. Indian Pharmacopeia & Brand Directory (Topical, Oral, Antibiotics, etc.)
# --------------------------------------------------------------------------
PHARMACEUTICAL_DIRECTORY: Final[dict[str, list[str]]] = {
    "TOPICAL_ANALGESICS": [
        "Volini", "Moov", "Omnigel", "Relispray", "Iodex", "Fastum Gel",
        "Voveran Emulgel", "Dynapar QPS", "Combiflam Gel", "Deep Heat",
    ],
    "ANALGESICS_ANTIPYRETICS": [
        "Dolo 650", "Crocin", "Calpol", "Paracetamol", "Combiflam", "Meftal-Spas",
        "Saridon", "Disprin", "Brufen", "Ibuprofen", "Zerodol", "Zerodol-P",
        "Zerodol-SP", "Hifenac", "Hifenac-P", "Aceclofenac", "Diclofenac",
        "Tramadol", "Ultracet", "Ketorolac", "Naproxen",
    ],
    "ANTACIDS_GASTRO": [
        "Pantocid", "Pan-D", "Pantoprazole", "Omez", "Omez-D", "Omeprazole",
        "Razo", "Rabeprazole", "Rabekind-DSR", "Nexpro", "Esomeprazole",
        "Rantac", "Aciloc", "Ranitidine", "Famocid", "Digene", "Gelusil",
        "Mucaine Gel", "Eno", "Cremaffin", "Duphalac", "Dulcolax", "Lactulose",
        "Isabgol", "Eldoper", "Loperamide", "Econorm", "Darolac", "Sporlac",
    ],
    "ANTIBIOTICS": [
        "Augmentin", "Clavam", "Moxikind-CV", "Amoxicillin", "Azithral", "Azee",
        "Azithromycin", "Ceftum", "Monocef", "Taxim-O", "Cefixime", "Cefpodoxime",
        "Gudcef", "Cifran", "Ciplox", "Ciprofloxacin", "Norflox-TZ", "Oflox-OZ",
        "Zenflox-OZ", "Levoflox", "Levofloxacin", "Doxycycline", "Metrogyl",
        "Flagyl", "Bactrim", "Septran",
    ],
    "ANTIALLELGIC_COUGH_COLD": [
        "Allegra", "Fexofenadine", "Cetirizine", "Cetzine", "Okacet",
        "Levocetirizine", "Montair-LC", "Montek-LC", "Montelukast", "Sinarest",
        "Cheston Cold", "Solvin Cold", "Maxtra", "Wikoryl", "Ascoril", "Ascoril-D",
        "Ascoril-LS", "Grilinctus", "Benadryl", "Alex", "Corex-DX", "Zedex",
        "Otrivin", "Nasivion", "Avil", "Pheniramine",
    ],
    "RESPIRATORY_INHALERS": [
        "Asthalin", "Salbutamol", "Budecort", "Budesonide", "Foracort", "Seroflo",
        "Duolin", "Ipratropium", "Deriphyllin", "Theophylline",
    ],
    "CARDIOVASCULAR_HYPERTENSION": [
        "Telma", "Telma-H", "Telma-AM", "Telmisartan", "Amlong", "Amlodipine",
        "Cilacar", "Cilnidipine", "Betaloc", "Metoprolol", "Atenolol", "Nebicard",
        "Nebivolol", "Cardace", "Ramipril", "Ecosprin", "Clopilet", "Atorva",
        "Atorvastatin", "Rosuvas", "Rosuvastatin", "Sorbitrate", "Nitroglycerin",
    ],
    "DIABETES": [
        "Glycomet", "Metformin", "Janumet", "Galvus-Met", "Glimepiride", "Amaryl",
        "Vildagliptin", "Teneligliptin", "Dapagliflozin", "Forxiga", "Jardiance",
        "Empagliflozin", "Human Mixtard", "Lantus",
    ],
    "VITAMINS_SUPPLEMENTS": [
        "Shelcal", "Cipcal", "Calcium", "Becosules", "Neurobion Forte", "Evion",
        "Vitamin E", "Supradyn", "Zincovit", "A to Z", "Liv-52", "Thyronorm",
        "Eltroxin", "Limcee", "Celin",
    ],
    "TOPICAL_ANTISEPTICS": [
        "Betadine", "Povidone Iodine", "Soframycin", "Burnol", "Candid",
        "Clotrimazole", "T-Bact", "Mupirocin", "Neosporin",
    ],
    "ANTIEMETICS": [
        "Vomikind", "Ondem", "Ondansetron", "Domstal", "Domperidone", "Perinorm",
        "Metoclopramide", "Stemetil",
    ],
}

# --------------------------------------------------------------------------
# 2. Symptoms & Clinical Findings Directory
# --------------------------------------------------------------------------
SYMPTOMS_DIRECTORY: Final[list[str]] = [
    "headache", "migraine", "fever", "high fever", "chills", "rigors",
    "body pain", "generalized body ache", "myalgia", "chest pain", "chest discomfort",
    "angina", "backache", "low back pain", "stomach ache", "abdominal pain",
    "gastric pain", "cramps", "joint pain", "knee pain", "arthralgia",
    "throat pain", "sore throat", "pharyngitis", "difficulty swallowing",
    "cough", "dry cough", "productive cough", "cold", "common cold",
    "running nose", "rhinorrhea", "nasal congestion", "sneezing",
    "vomiting", "nausea", "loose motion", "diarrhea", "constipation",
    "acidity", "heartburn", "acid reflux", "bloating", "flatulence",
    "giddiness", "vertigo", "dizziness", "lightheadedness", "fainting",
    "breathlessness", "shortness of breath", "dyspnea", "wheezing",
    "palpitations", "fatigue", "weakness", "lethargy", "loss of appetite",
    "swelling", "pedal edema", "skin rash", "itching", "pruritus", "allergy",
    "burning micturition", "dysuria", "frequent urination",
]

# --------------------------------------------------------------------------
# 3. Clinical Vitals & Investigations
# --------------------------------------------------------------------------
CLINICAL_FINDINGS_DIRECTORY: Final[list[str]] = [
    "BP", "blood pressure", "high BP", "low BP", "pulse", "heart rate",
    "temperature", "febrile", "afebrile", "SpO2", "oxygen saturation",
    "respiratory rate", "blood sugar", "fasting blood sugar", "postprandial sugar",
    "HbA1c", "ECG", "X-Ray", "chest X-Ray", "ultrasound", "USG abdomen",
    "CT scan", "MRI", "blood test", "complete blood count", "CBC",
    "hemoglobin", "platelet count", "liver function test", "LFT",
    "kidney function test", "KFT", "serum creatinine", "lipid profile",
    "urine routine", "thyroid profile", "TSH",
]

# --------------------------------------------------------------------------
# 4. Phonetic Mishear Acoustic Mappings (Whisper -> Clinical Term)
# --------------------------------------------------------------------------
PHONETIC_CORRECTIONS: Final[list[tuple[re.Pattern[str], str]]] = [
    # Volini (topical analgesic gel/spray)
    (
        re.compile(
            r"\b(?:volini|voline|voleny|valini|fall\s*in\s*he|fall\s*in\s*e|fallini|folini|vallini|for\s*lean|pole\s*in\s*e|fall\s*on\s*me|fall\s*in)\s*(?:gel|spray|ointment|cream)?\b",
            re.IGNORECASE,
        ),
        "Volini",
    ),
    # Moov
    (re.compile(r"\b(?:moov|move)\s*(?:gel|spray|ointment|cream)\b", re.IGNORECASE), "Moov"),
    # Omnigel
    (re.compile(r"\b(?:omni\s*gel|omnigel)\b", re.IGNORECASE), "Omnigel"),
    # Relispray
    (re.compile(r"\b(?:reli\s*spray|relispray)\b", re.IGNORECASE), "Relispray"),
    # Iodex
    (re.compile(r"\b(?:io\s*dex|iodex)\b", re.IGNORECASE), "Iodex"),
    # Fastum Gel
    (re.compile(r"\b(?:fastum\s*gel|fastum)\b", re.IGNORECASE), "Fastum Gel"),
    # Voveran
    (re.compile(r"\b(?:voveran|voveron)\b", re.IGNORECASE), "Voveran"),
    # Dynapar
    (re.compile(r"\b(?:dynapar|dyna\s*par)\b", re.IGNORECASE), "Dynapar"),
    # Saridon
    (re.compile(r"\b(?:sari\s*don|saridon)\b", re.IGNORECASE), "Saridon"),
    # Disprin
    (re.compile(r"\b(?:dis\s*prin|disprin)\b", re.IGNORECASE), "Disprin"),
    # Combiflam
    (re.compile(r"\b(?:combi\s*flam|combiflam)\b", re.IGNORECASE), "Combiflam"),
    # Meftal-Spas
    (re.compile(r"\b(?:meftal\s*[- ]?spas|meftal|mef\s*tal|mephtal)\b", re.IGNORECASE), "Meftal-Spas"),
    # Dolo misheard as "dark tablet" / "dollar tablet". The strength is not
    # added: only "Dolo 650" when 650 was actually spoken (next rule).
    (re.compile(r"\b(?:dark|dollar|dollo|dhollo|dholo|dolo)\s+(tablets?|tab)\b", re.IGNORECASE), r"Dolo \1"),
    # Dolo 650
    (re.compile(r"\b(?:dolo|dola|dolor|dollo)\s*(?:[- ]?650|six\s*fifty)\b", re.IGNORECASE), "Dolo 650"),
    (re.compile(r"\b(?:dolo|dola|dolor)\b(?=\s*(?:tablet|tab|dose|daily|twice|once|thrice|mg))", re.IGNORECASE), "Dolo"),
    # Crocin
    (re.compile(r"\b(?:crossin|crocin)\b", re.IGNORECASE), "Crocin"),
    # Calpol
    (re.compile(r"\b(?:calpol|cal\s*pol)\b", re.IGNORECASE), "Calpol"),
    # Paracetamol
    (re.compile(r"\b(?:paracet\s*model|paracet\s*mol|paracetmol|paracetamol)\b", re.IGNORECASE), "Paracetamol"),
    # Zerodol
    (re.compile(r"\b(?:zerodol\s*[- ]?[ps]p?|zero\s*dol)\b", re.IGNORECASE), "Zerodol"),
    # Pan-D & Pantocid
    (re.compile(r"\b(?:pan\s*[- ]?d|penn\s*[- ]?d)\b", re.IGNORECASE), "Pan-D"),
    (re.compile(r"\b(?:pan|pen|panto)\s*[- ]?(?:40|forty)\b", re.IGNORECASE), "Pan 40"),
    (re.compile(r"\b(?:panto\s*sid|pantocid|pantodac|panto\s*side)\b", re.IGNORECASE), "Pantocid"),
    (re.compile(r"\b(?:omez\s*[- ]?d|omez)\b", re.IGNORECASE), "Omez"),
    (re.compile(r"\b(?:rantac|ran\s*tac|aciloc)\b", re.IGNORECASE), "Rantac"),
    # Digene, Gelusil, Eno
    (re.compile(r"\b(?:di\s*gene|digene|die\s*gene)\b", re.IGNORECASE), "Digene"),
    (re.compile(r"\b(?:gelu\s*sil|gelusil)\b", re.IGNORECASE), "Gelusil"),
    (re.compile(r"\b(?:elec\s*tral|electral|e\s*lectral)\b", re.IGNORECASE), "Electral ORS"),
    # Augmentin & Clavam
    (re.compile(r"\b(?:ogmentin|aug\s*mentin|augmentin|augmenting|augment\s+in)\b", re.IGNORECASE), "Augmentin"),
    (re.compile(r"\b(?:claw\s*vam|clavam)\b", re.IGNORECASE), "Clavam"),
    # Azithral
    (re.compile(r"\b(?:azithral|a\s*zee|azithromycin)\b", re.IGNORECASE), "Azithral"),
    # Ceftum, Monocef, Taxim-O
    (re.compile(r"\b(?:sef\s*tum|ceftum)\b", re.IGNORECASE), "Ceftum"),
    (re.compile(r"\b(?:mono\s*cef|monocef)\b", re.IGNORECASE), "Monocef"),
    (re.compile(r"\b(?:taxim\s*[- ]?o|taxim)\b", re.IGNORECASE), "Taxim-O"),
    # Cough & Cold
    (re.compile(r"\b(?:sina\s*rest|sinarest|sinarist|sinnarest|seena\s*rest)\b", re.IGNORECASE), "Sinarest"),
    (re.compile(r"\b(?:cheston\s*cold|cheston|chest\s+on\s+cold|chesten\s*cold)\b", re.IGNORECASE), "Cheston Cold"),
    (re.compile(r"\b(?:otri\s*vin|otrivin)\b", re.IGNORECASE), "Otrivin"),
    (re.compile(r"\b(?:asco\s*ril|ascoril)\b", re.IGNORECASE), "Ascoril"),
    (re.compile(r"\b(?:bena\s*dryl|benadryl)\b", re.IGNORECASE), "Benadryl"),
    (re.compile(r"\b(?:grilinc\s*tus|grilinctus)\b", re.IGNORECASE), "Grilinctus"),
    (re.compile(r"\b(?:a\s*legra|allegra)\b", re.IGNORECASE), "Allegra"),
    (re.compile(r"\b(?:montek\s*[- ]?lc|montair\s*[- ]?lc)\b", re.IGNORECASE), "Montair-LC"),
    (re.compile(r"\b(?:cetrizine|citrizine|cetirizine|cetzine)\b", re.IGNORECASE), "Cetirizine"),
    # Antiemetics
    (re.compile(r"\b(?:vomi\s*kind|vomikind)\b", re.IGNORECASE), "Vomikind"),
    (re.compile(r"\b(?:on\s*dem|ondem)\b", re.IGNORECASE), "Ondem"),
    # Chronic conditions & BP
    (re.compile(r"\b(?:tell\s*my|tel\s*my|telma)\s*(20|40|80)?\b", re.IGNORECASE), r"Telma \1"),
    (re.compile(r"\b(?:am\s*long|amlong)\b", re.IGNORECASE), "Amlong"),
    (re.compile(r"\b(?:cila\s*car|cilacar)\b", re.IGNORECASE), "Cilacar"),
    (re.compile(r"\b(?:glyco\s*met|glycomet)\b", re.IGNORECASE), "Glycomet"),
    (re.compile(r"\b(?:met\s*formin|metformin)\b", re.IGNORECASE), "Metformin"),
    (re.compile(r"\b(?:a\s*torva|atorva|atorvastatin)\b", re.IGNORECASE), "Atorva"),
    (re.compile(r"\b(?:ro\s*suvas|rosuvas|rosuvastatin)\b", re.IGNORECASE), "Rosuvas"),
    (re.compile(r"\b(?:eco\s*sprin|eco\s*spring|ecosprin)\b", re.IGNORECASE), "Ecosprin"),
    (re.compile(r"\b(?:shelcal|shel\s*cal)\b", re.IGNORECASE), "Shelcal"),
    (re.compile(r"\b(?:becosules|beco\s*sules)\b", re.IGNORECASE), "Becosules"),
    (re.compile(r"\b(?:supradyn|supra\s*dyn)\b", re.IGNORECASE), "Supradyn"),
    (re.compile(r"\b(?:neuro\s*bion|neurobion)\b", re.IGNORECASE), "Neurobion"),
    (re.compile(r"\b(?:evi\s*on|evion)\b", re.IGNORECASE), "Evion"),
    (re.compile(r"\b(?:liv\s*[- ]?52)\b", re.IGNORECASE), "Liv-52"),
    (re.compile(r"\b(?:thyro\s*norm|thyronorm|eltroxin)\b", re.IGNORECASE), "Thyronorm"),
    # Topicals
    (re.compile(r"\b(?:beta\s*dine|betadine)\b", re.IGNORECASE), "Betadine"),
    (re.compile(r"\b(?:sofra\s*mycin|soframycin)\b", re.IGNORECASE), "Soframycin"),
    (re.compile(r"\b(?:bur\s*nol|burnol)\b", re.IGNORECASE), "Burnol"),

    # Common English Medical Phonetic Mishears
    (re.compile(r"\b(?:head\s*day|head\s*date|head\s*eight|head\s*take|head\s*ache)\b", re.IGNORECASE), "headache"),
    (re.compile(r"\b(?:stomach\s*day|stomach\s*date|stomach\s*eight|stomach\s*cake|stomach\s*ache)\b", re.IGNORECASE), "stomach ache"),
    (re.compile(r"\b(?:back\s*day|back\s*date|back\s*eight|back\s*cake|back\s*ache)\b", re.IGNORECASE), "backache"),
    (re.compile(r"\b(?:ear\s*day|ear\s*date|ear\s*eight|ear\s*ache)\b", re.IGNORECASE), "earache"),
    (re.compile(r"\b(?:tooth\s*day|tooth\s*date|tooth\s*eight|tooth\s*ache)\b", re.IGNORECASE), "toothache"),
    (re.compile(r"\b(?:body\s*pane|body\s*pains)\b", re.IGNORECASE), "body pain"),
    (re.compile(r"\b(?:chest\s*pane)\b", re.IGNORECASE), "chest pain"),
    (re.compile(r"\b(?:joint\s*pane|joint\s*pains)\b", re.IGNORECASE), "joint pain"),
    (re.compile(r"\b(?:throat\s*pane)\b", re.IGNORECASE), "throat pain"),
    (re.compile(r"\b(?:blood\s*presser|blood\s*pleasure)\b", re.IGNORECASE), "blood pressure"),
    (re.compile(r"\b(?:hi\s*bp|high\s*b\s*\.?\s*p\.?)\b", re.IGNORECASE), "high BP"),
    (re.compile(r"\b(?:low\s*bp|low\s*b\s*\.?\s*p\.?)\b", re.IGNORECASE), "low BP"),
    (re.compile(r"\b(?:loose\s*motions)\b", re.IGNORECASE), "loose motion"),
    (re.compile(r"\b(?:running\s*nose|runny\s*nose)\b", re.IGNORECASE), "running nose"),
    (re.compile(r"\b(?:soar\s*throat)\b", re.IGNORECASE), "sore throat"),
    (re.compile(r"\b(?:giddines)\b", re.IGNORECASE), "giddiness"),
    (re.compile(r"\b(?:vomitting)\b", re.IGNORECASE), "vomiting"),
]
