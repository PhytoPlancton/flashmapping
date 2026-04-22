"""Pharma role taxonomy: classify a job title into level + category + flags.

Ported from /Users/nicolasmonniot/Documents/CODE/mapping/roles_taxonomy.py.
Keeps the regex/keyword approach. Adds:
- A `level` int (1-6) derived from seniority + C-Level subtype.
- A slug `category` chosen from a fixed enum matching the API contract.
"""
from __future__ import annotations

import re
from typing import Optional

SENIORITY_TOP = [
    r"\bchief\b", r"\bc[\- ]?level\b", r"\bceo\b", r"\bcoo\b", r"\bcfo\b",
    r"\bcdo\b", r"\bcio\b", r"\bcto\b", r"\bcmo\b", r"\bcso\b", r"\bchro\b",
    r"(?<!vice )(?<!corporate )\bpresident\b",
    r"(?<!vice )\bpr[ée]sident\b",
    r"\bgeneral manager\b", r"\bdirecteur g[ée]n[ée]ral\b",
    r"\bcountry manager\b", r"\bmanaging director\b",
    r"\bdg\s+[A-Za-z]",
    r"\bglobal head\b",
]

SENIORITY_VP = [r"\bvp\b", r"\bvice.?president\b", r"\bsvp\b", r"\bevp\b"]
SENIORITY_HEAD = [
    r"\bhead of\b", r"\bhead\b",
    r"\bdirecteur\b", r"\bdirectrice\b",
    r"\bdirector\b", r"\bleader\b", r"\blead\b",
]
SENIORITY_SENIOR = [r"\bsenior director\b", r"\bsenior manager\b", r"\bprincipal\b"]
SENIORITY_MANAGER = [r"\bmanager\b", r"\bchef\b", r"\bresponsable\b"]
SENIORITY_JUNIOR = [
    r"\bintern\b", r"\bstagiaire\b", r"\bassistant\b", r"\bjunior\b",
    r"\btrainee\b", r"\bapprenti\b",
]

# Level-1 patterns (General Management top): CEO / President / DG / GM / Country Manager.
LEVEL_1_TOP_PATTERNS = [
    r"\bceo\b",
    r"(?<!vice )(?<!corporate )\bpresident\b",
    r"(?<!vice )\bpr[ée]sident\b",
    r"\bgeneral manager\b", r"\bmanaging director\b",
    r"\bcountry manager\b",
    r"\bdirecteur g[ée]n[ée]ral\b",
    r"\bdg\s+[A-Za-z]",
    r"\bchief executive\b",
]

# Multi-label category patterns, ordered for precedence.
CATEGORY_LABELS = [
    "C-Level / GM",
    "Digital / Transformation",
    "Data / AI",
    "IT / IS",
    "Medical Affairs",
    "Market Access",
    "Commercial Excellence",
    "R&D / Clinical",
    "Operations / Supply Chain",
    "Finance",
    "Legal",
    "Marketing / Brand",
    "HR / People",
    "Regulatory / Quality",
]

CATEGORIES: dict[str, list[str]] = {
    "C-Level / GM": [
        # Generic top-of-org titles WITHOUT a more specific domain match.
        # Chief Digital / Data / Medical etc. should land in their domain,
        # not here — the `flag_c_level` on the contact already captures
        # the C-level status separately.
        r"\bchief (executive|operating|financial|human resources|strategy|business|corporate|alliances)\b",
        r"\bceo\b", r"\bcoo\b", r"\bcfo\b", r"\bchro\b",
        r"(?<!vice )(?<!corporate )\bpresident\b",
        r"(?<!vice )\bpr[ée]sident\b",
        r"\bcountry (manager|head|director)\b",
        r"\bgeneral manager\b", r"\bmanaging director\b",
        r"\bdirecteur g[ée]n[ée]ral\b", r"\bdg\s+[a-z]",
        r"\bexecutive board member\b", r"\bmember of the executive (committee|board)\b",
    ],
    "Digital / Transformation": [
        r"\bchief digital\b", r"\bcdo\b",
        r"\bdigital transformation\b", r"\btransformation digitale\b",
        r"\btransfo digitale\b",
        r"\btransformation officer\b",
        r"\bhead of digital\b", r"\bvp digital\b", r"\bdirecteur digital\b",
        r"\bomnichannel\b", r"\bomnicanal\b",
        r"\bdigital (factory|lab|office|strategy|excellence|health|channels)\b",
        r"\b(head|vp|director|chief).{0,15}innovation\b",
        r"\brespo.{0,10}transfo\b",
        r"\binnovation (lab|factory|office|lead|capability|services)\b",
    ],
    "Data / AI": [
        r"\bchief data\b", r"\bcdo\b",
        r"\bhead of data\b", r"\bdata officer\b",
        r"\b(head|vp|director|chief).{0,15}(ai|artificial intelligence|machine learning|analytics|data)\b",
        r"\bai lead\b", r"\bml lead\b",
        r"\bdata science lead\b",
        r"\b(data and ai|data & ai|data/ai)\b",
        r"\bdata experimentation\b",
        r"\bscientific director.{0,30}(data|ai)\b",
        r"\brespo.{0,10}(bi|data)\b",
    ],
    "IT / IS": [
        r"\bcio\b", r"\bcto\b", r"\bchief information\b", r"\bchief technology\b",
        r"\bhead of (it|is|information systems|information technology)\b",
        r"\bvp (it|is|information)\b",
        r"\bit director\b", r"\bis director\b", r"\btechnology director\b",
        r"\bdirecteur (si|s\.i\.|informatique|systèmes d'information)\b",
        r"\bsoftware engineering\b", r"\bcybersecurity\b", r"\bsécurité informatique\b",
        r"\bis manager\b", r"\binformation system manager\b",
    ],
    "Medical Affairs": [
        r"\bchief medical\b", r"\bcmo\b",
        r"\b(vp|head of|director|chief).{0,30}medical\b",
        r"\bmedical (affairs|director|excellence|lead)\b",
        r"\bmsl (lead|head|manager)\b",
        r"\bmedical science liaison\b",
        r"\bdirecteur m[ée]dical\b", r"\bdirecteur des affaires m[ée]dicales\b",
        r"\b(clinical|medical|regulatory)(/|, ?| & | and )(clinical|medical|regulatory)\b",
    ],
    "Market Access": [
        r"\bmarket access\b",
        r"\bheor\b", r"\bhealth economics\b",
        r"\bpricing.{0,20}reimbursement\b",
        r"\bacc[èe]s au march[ée]\b",
    ],
    "Commercial Excellence": [
        r"\bcommercial excellence\b",
        r"\bsales excellence\b", r"\bsfe\b", r"\bsales force effectiveness\b",
        r"\b(head|vp|director|chief).{0,30}(sales|commercial)\b",
        r"\b(sales|commercial).{0,30}(director|head|vp|manager)\b",
        r"\bsales operations\b", r"\bsales ops\b",
        r"\bbusiness excellence\b",
        r"\bbusiness development\b", r"\bmarket development\b",
        r"\b(key )?account (director|manager|executive)\b",
        r"\bregional business director\b", r"\bdistrict business\b",
        r"\bdirector.{0,15}(ventas|sales)\b", r"\bdirector de ventas\b",
        r"\bdirecteur.{0,10}ventes\b", r"\bdirectrice.{0,10}ventes\b",
        r"\bcommercial (coordination|operations|excellence|capability)\b",
        r"\bhead.{0,30}(markets? region|mid-size markets)\b",
    ],
    "R&D / Clinical": [
        r"\bchief scientific\b", r"\bcso\b", r"\bchief science\b",
        r"\b(vp|head of|director) r&?d\b", r"\bhead of research\b",
        r"\bclinical operations\b", r"\bhead of clinical\b",
        r"\bdirecteur (r&?d|recherche)\b",
        r"\bproduct development\b", r"\bdéveloppement produit\b",
        r"\bscientific (affairs|director|officer)\b",
        r"\bscience and technology\b",
        r"\br&d, technology and innovation\b", r"\br&d,? innovation\b",
    ],
    "Regulatory / Quality": [
        r"\bregulatory affairs\b", r"\baffaires r[ée]glementaires\b",
        r"\bquality assurance\b", r"\bqa director\b", r"\bqualit[ée]\b",
        r"\bcqo\b", r"\bchief quality\b",
        r"\b(head|vp|director).{0,20}quality\b",
        r"\bhse\b", r"\behs\b", r"\benvironment.{0,5}(health|safety)\b",
        r"\bresponsable.{0,10}hse\b", r"\bresponsable.{0,10}ehs\b",
    ],
    "HR / People": [
        r"\bchro\b", r"\bchief human\b", r"\bchief people\b", r"\bchief talent\b",
        r"\b(head of|vp|director|chief) (hr|human resources|people|talent)\b",
        r"\bhr (director|department|manager|lead|head|country)\b",
        r"\bhuman resources? (director|department|manager|lead|head|business)\b",
        r"\btalent acquisition\b", r"\btalent management\b",
        r"\bhr business partner\b", r"\bhrbp\b",
        r"\bpeople.{0,15}organization\b", r"\bpeople & organization\b",
        r"\blearning.{0,5}development\b",
        r"\bdrh\b", r"\bdirecteur.{0,10}(rh|ressources humaines)\b",
        r"\bdirectrice.{0,10}(rh|ressources humaines)\b",
        r"\bdirecteur[a-zA-Z ]+ressources\b",
    ],
    "Marketing / Brand": [
        r"\bchief marketing\b",
        r"\b(head|vp|director|chief).{0,30}(marketing|brand)\b",
        r"\b(marketing|brand).{0,30}(director|head|vp|lead|manager)\b",
        r"\bbrand (director|lead|manager|activation)\b",
        r"\bmarketing (director|communications|innovation)\b",
        r"\bglobal marketing\b",
        r"\b(head|vp|director).{0,20}communications?\b",
        r"\bsvp.{0,20}communications?\b",
        r"\bcommunication externe\b", r"\bexternal (affairs|communications)\b",
        r"\bthought leader (liaison|lead)\b",
    ],
    "Operations / Supply Chain": [
        r"\bsupply chain\b", r"\bchaîne d'approvisionnement\b",
        r"\b(head|vp|director|chief).{0,20}(operations|operational|supply)\b",
        r"\b(operations|operational|supply).{0,20}(director|head|vp|manager)\b",
        r"\boperational excellence\b", r"\bexcellence op[ée]rationnelle\b",
        r"\bmanufacturing\b", r"\bproduction\b",
        r"\bprocurement\b", r"\bpurchasing\b", r"\bachats?\b",
        r"\bsourcing\b", r"\bapprovisionnement\b",
        r"\bstrategic purchase\b",
        r"\bplant (manager|director|head)\b", r"\bsite (manager|director|head)\b",
        r"\blogistics\b", r"\blogistique\b",
        r"\bwarehouse\b", r"\bdistribution\b",
    ],
    "Finance": [
        r"\bcfo\b", r"\bchief financial\b",
        r"\b(head|vp|director|chief).{0,20}(finance|financial|controlling|treasury|audit|accounting)\b",
        r"\bfinance & controlling\b", r"\bfinance and controlling\b",
        r"\bfp&a\b", r"\bfinancial planning\b",
        r"\binvestor relations\b", r"\bm&a\b", r"\bmergers.{0,5}acquisitions\b",
        r"\bstrategy.{0,10}m&a\b", r"\bcorporate development\b",
        r"\bcontrôleur\b", r"\bcontrôleuse\b", r"\bcontrolling\b",
        r"\bdirecteur financier\b",
        r"\btreasurer\b", r"\btrésorier\b",
    ],
    "Legal": [
        r"\bchief legal\b", r"\bgeneral counsel\b",
        r"\b(head|vp|director).{0,15}legal\b",
        r"\blegal counsel\b", r"\blead counsel\b",
        r"\bdirecteur juridique\b", r"\bdirectrice juridique\b",
        r"\bcompliance\b", r"\bcomplicance officer\b",
        r"\blitigation\b",
    ],
}

THERAPEUTIC_AREAS: dict[str, list[str]] = {
    "Oncology": [r"\boncolog", r"\bh[ée]matolog", r"\btumor\b", r"\bcancer\b"],
    "Diabetes / Obesity / Metabolic": [
        r"\bdiabet", r"\bob[eé]sit", r"\bmetabol", r"\bglp-?1\b", r"\bendocrin",
    ],
    "Rare Disease": [r"\brare disease", r"\bmaladie[s]? rare", r"\borphan\b"],
    "Vaccines": [r"\bvaccine", r"\bvaccin", r"\bimmunization"],
    "Immunology": [r"\bimmunolog", r"\bautoimmune", r"\bauto-?immun"],
    "Neuroscience / CNS": [
        r"\bneuroscien", r"\bneurolog", r"\bcns\b", r"\bpsychiat", r"\bbrain\b",
    ],
    "Cardiovascular": [r"\bcardio", r"\bcardiovascular", r"\bheart\b"],
    "Dermatology": [r"\bdermato", r"\bskin\b", r"\bpsoriasis"],
    "Wound Care": [r"\bwound\b", r"\bplaie", r"\burgo medical"],
    "Respiratory": [r"\brespirator", r"\bpulmonar", r"\bcopd\b", r"\basthma"],
    "Ophthalmology": [r"\bophthalmo", r"\bophtalmo", r"\beye\b", r"\bretina"],
    "Women's Health": [r"\bwomen'?s health", r"\bgyn[ée]colog", r"\bfertility"],
    "Consumer Health / OTC": [r"\bconsumer health", r"\botc\b", r"\bself[- ]?care"],
    "Medical Devices": [r"\bmedical device", r"\bdispositif m[ée]dical"],
    "Generics / Biosimilars": [
        r"\bgeneric", r"\bbiosimilar", r"\bg[ée]n[ée]riques?",
    ],
}

BU_HEAD_PATTERNS = [
    r"\b(head|chief|director|vp|lead|gm|general manager) of (the )?([A-Z][a-z]+ ?){1,3}(bu|business unit|franchise|division)\b",
    r"\b(bu|business unit|franchise) (head|director|lead|manager)\b",
    r"\bhead of ([A-Z][a-zA-Z&\- /]+?)(franchise|business)?\b",
    r"\bgeneral manager.{0,30}(oncology|diabetes|rare|vaccines|neuro|cardio|dermato|obesity|immunology|respiratory)\b",
]


# Category slug mapping (API enum) — ordered by precedence when multiple labels match.
CATEGORY_SLUG_ORDER = [
    "c_level",
    "digital",
    "data_ai",
    "it_is",
    "medical",
    "market_access",
    "commercial",
    "rd_clinical",
    "operations",
    "finance",
    "legal",
    "marketing",
    "hr",
    "quality",
    "other",
]

CATEGORY_LABEL_TO_SLUG = {
    "C-Level / GM": "c_level",
    "Digital / Transformation": "digital",
    "Data / AI": "data_ai",
    "IT / IS": "it_is",
    "Medical Affairs": "medical",
    "Market Access": "market_access",
    "Commercial Excellence": "commercial",
    "R&D / Clinical": "rd_clinical",
    "Operations / Supply Chain": "operations",
    "Finance": "finance",
    "Legal": "legal",
    "HR / People": "hr",
    "Marketing / Brand": "marketing",
    "Regulatory / Quality": "quality",
}


def _match_any(patterns: list[str], text: str) -> bool:
    return any(re.search(p, text, re.IGNORECASE) for p in patterns)


def _match_all_labels(pat_dict: dict[str, list[str]], text: str) -> list[str]:
    return [k for k, pats in pat_dict.items() if _match_any(pats, text)]


def _pick_slug(labels: list[str]) -> str:
    """Pick the highest-precedence slug from a list of category labels."""
    slugs = {CATEGORY_LABEL_TO_SLUG[l] for l in labels if l in CATEGORY_LABEL_TO_SLUG}
    for s in CATEGORY_SLUG_ORDER:
        if s in slugs:
            return s
    return "other"


def _derive_level(seniority: str, title_lower: str) -> int:
    """Map seniority label (+ title context) to an integer level 1-6."""
    if seniority == "Top (C-Level/GM)":
        if _match_any(LEVEL_1_TOP_PATTERNS, title_lower):
            return 1
        return 2
    if seniority in ("VP", "Senior Director/Manager"):
        return 3
    if seniority == "Head / Director":
        return 4
    if seniority == "Manager":
        return 5
    # IC / Unknown / Junior
    return 6


def classify(title: Optional[str]) -> dict:
    """Classify a job title.

    Returns a dict with:
        level: int 1-6
        category: slug in CATEGORY_SLUG_ORDER
        seniority: human-readable seniority label
        flag_c_level: bool
        flag_bu_head: bool
        flag_manager_of_managers: bool
        therapeutic_areas: list[str]
        priority_score: int 0-100
    """
    result = {
        "level": 6,
        "category": "other",
        "seniority": "Unknown",
        "flag_c_level": False,
        "flag_bu_head": False,
        "flag_manager_of_managers": False,
        "therapeutic_areas": [],
        "priority_score": 0,
    }

    if not title or not title.strip():
        return result

    t = title.strip()
    tl = t.lower()

    # Junior short-circuit.
    if _match_any(SENIORITY_JUNIOR, tl):
        result["seniority"] = "Junior"
        result["level"] = 6
        return result

    # Seniority ladder — first match wins, top-down.
    if _match_any(SENIORITY_TOP, tl):
        seniority = "Top (C-Level/GM)"
        result["flag_c_level"] = True
    elif _match_any(SENIORITY_VP, tl):
        seniority = "VP"
    elif _match_any(SENIORITY_SENIOR, tl):
        seniority = "Senior Director/Manager"
    elif _match_any(SENIORITY_HEAD, tl):
        seniority = "Head / Director"
    elif _match_any(SENIORITY_MANAGER, tl):
        seniority = "Manager"
    else:
        seniority = "IC / Unknown"

    result["seniority"] = seniority
    result["level"] = _derive_level(seniority, tl)

    # Manager-of-managers heuristic.
    if seniority in ("Top (C-Level/GM)", "VP", "Senior Director/Manager"):
        result["flag_manager_of_managers"] = True
    elif seniority == "Head / Director" and re.search(
        r"\b(global|group|worldwide|europe|emea)\b", tl
    ):
        result["flag_manager_of_managers"] = True

    # Multi-label categories.
    labels = _match_all_labels(CATEGORIES, tl)

    # Disambiguate CMO: marketing vs medical.
    if "Medical Affairs" in labels and "Marketing / Brand" in labels:
        if re.search(r"\bmedical\b", tl):
            labels.remove("Marketing / Brand")
        elif re.search(r"\bmarketing\b", tl) and not re.search(r"\bmedical\b", tl):
            labels.remove("Medical Affairs")

    result["category"] = _pick_slug(labels)

    # Therapeutic areas.
    result["therapeutic_areas"] = _match_all_labels(THERAPEUTIC_AREAS, tl)

    # BU head.
    if _match_any(BU_HEAD_PATTERNS, tl):
        result["flag_bu_head"] = True
    elif result["therapeutic_areas"] and seniority in (
        "Top (C-Level/GM)", "VP", "Head / Director", "Senior Director/Manager",
    ):
        result["flag_bu_head"] = True

    # Priority score.
    score = 0
    if result["flag_c_level"]:
        score += 40
    if "Digital / Transformation" in labels:
        score += 30
    if "Data / AI" in labels:
        score += 25
    if "IT / IS" in labels:
        score += 15
    if "Commercial Excellence" in labels:
        score += 20
    if "Medical Affairs" in labels:
        score += 10
    if "Market Access" in labels:
        score += 10
    if result["flag_bu_head"]:
        score += 15
    if seniority == "VP":
        score += 15
    elif seniority == "Head / Director":
        score += 10
    elif seniority == "Senior Director/Manager":
        score += 5
    elif seniority == "Manager":
        score += 2
    result["priority_score"] = min(score, 100)

    return result
