"""Pharma role taxonomy: classify a job title into categories + flags.

Kept pragmatic: regex/keyword matching, multi-label. No LLM.
Priorities follow muchbetter.ai's ICP (Digital/Data/AI first, then Medical/Commercial).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


SENIORITY_TOP = [
    r"\bchief\b", r"\bc[\- ]?level\b", r"\bceo\b", r"\bcoo\b", r"\bcfo\b",
    r"\bcdo\b", r"\bcio\b", r"\bcto\b", r"\bcmo\b", r"\bcso\b", r"\bchro\b",
    r"(?<!vice )(?<!corporate )\bpresident\b",
    r"(?<!vice )\bpr[ée]sident\b",
    r"\bgeneral manager\b", r"\bdirecteur g[ée]n[ée]ral\b",
    r"\bcountry manager\b", r"\bmanaging director\b",
    r"\bdg\s+[A-Z]",  # "DG France", "DG Europe"
    r"\bglobal head\b",
]

SENIORITY_VP = [r"\bvp\b", r"\bvice.?president\b", r"\bsvp\b", r"\bevp\b"]
SENIORITY_HEAD = [r"\bhead of\b", r"\bhead\b", r"\bdirecteur\b", r"\bdirector\b", r"\bleader\b", r"\blead\b"]
SENIORITY_SENIOR = [r"\bsenior director\b", r"\bsenior manager\b", r"\bprincipal\b"]
SENIORITY_MANAGER = [r"\bmanager\b", r"\bchef\b", r"\bresponsable\b"]
SENIORITY_JUNIOR = [r"\bintern\b", r"\bstagiaire\b", r"\bassistant\b", r"\bjunior\b", r"\btrainee\b", r"\bapprenti\b"]


# Category keyword sets — ordered for precedence (first match wins per label).
CATEGORIES = {
    "C-Level / GM": [
        r"\bchief (executive|operating|financial|human resources|strategy)\b",
        r"\bceo\b", r"\bcoo\b", r"\bcfo\b", r"\bchro\b", r"\bcso\b",
        r"(?<!vice )(?<!corporate )\bpresident\b",
        r"(?<!vice )\bpr[ée]sident\b",
        r"\bcountry (manager|head|director)\b",
        r"\bgeneral manager\b", r"\bmanaging director\b",
        r"\bdirecteur g[ée]n[ée]ral\b", r"\bdg\s+[a-z]",
    ],
    "Digital / Transformation": [
        r"\bchief digital\b", r"\bcdo\b",
        r"\bdigital transformation\b", r"\btransformation digitale\b",
        r"\btransformation officer\b",
        r"\bhead of digital\b", r"\bvp digital\b", r"\bdirecteur digital\b",
        r"\bomnichannel\b", r"\bomnicanal\b",
        r"\bdigital (factory|lab|office|strategy|excellence)\b",
        r"\b(head|vp|director|chief).{0,15}innovation\b",
        r"\brespo.{0,10}transfo\b",  # FR abbreviations from CRM
        r"\binnovation (lab|factory|office|lead)\b",
    ],
    "Data / AI": [
        r"\bchief data\b", r"\bcdo\b",  # overlaps with Digital CDO — fine, multi-label
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
        r"\bit director\b", r"\bis director\b",
        r"\bdirecteur (si|s\.i\.|informatique|systèmes d'information)\b",
    ],
    "Medical Affairs": [
        r"\bchief medical\b", r"\bcmo\b",
        r"\b(vp|head of|director|chief).{0,30}medical\b",
        r"\bmedical (affairs|director|excellence|lead)\b",
        r"\bmsl (lead|head|manager)\b",
        r"\bmedical science liaison\b",
        r"\bdirecteur m[ée]dical\b",
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
        r"\bsales operations\b", r"\bsales ops\b",
        r"\bbusiness excellence\b",
    ],
    "R&D / Clinical": [
        r"\bchief scientific\b", r"\bcso\b",
        r"\b(vp|head of) r&?d\b", r"\bhead of research\b",
        r"\bclinical operations\b", r"\bhead of clinical\b",
        r"\bdirecteur (r&?d|recherche)\b",
    ],
    "Regulatory / Quality": [
        r"\bregulatory affairs\b", r"\baffaires r[ée]glementaires\b",
        r"\bquality assurance\b", r"\bqa director\b", r"\bqualit[ée]\b",
    ],
    "HR / People": [
        r"\bchro\b", r"\bchief human\b",
        r"\b(head of|vp) (hr|human resources|people)\b",
        r"\bdrh\b", r"\bdirecteur.{0,10}(rh|ressources humaines)\b",
    ],
    "Marketing / Brand": [
        r"\bchief marketing\b",  # note: may conflict with CMO=medical — we disambiguate
        r"\bhead of marketing\b", r"\bvp marketing\b",
        r"\bbrand (director|lead|manager)\b",
        r"\bmarketing director\b",
    ],
}


# Therapeutic area keywords — contact gets tagged with the area if title mentions it.
THERAPEUTIC_AREAS = {
    "Oncology": [r"\boncolog", r"\bh[ée]matolog", r"\btumor\b", r"\bcancer\b"],
    "Diabetes / Obesity / Metabolic": [r"\bdiabet", r"\bob[eé]sit", r"\bmetabol", r"\bglp-?1\b", r"\bendocrin"],
    "Rare Disease": [r"\brare disease", r"\bmaladie[s]? rare", r"\borphan\b"],
    "Vaccines": [r"\bvaccine", r"\bvaccin", r"\bimmunization"],
    "Immunology": [r"\bimmunolog", r"\bautoimmune", r"\bauto-?immun"],
    "Neuroscience / CNS": [r"\bneuroscien", r"\bneurolog", r"\bcns\b", r"\bpsychiat", r"\bbrain\b"],
    "Cardiovascular": [r"\bcardio", r"\bcardiovascular", r"\bheart\b"],
    "Dermatology": [r"\bdermato", r"\bskin\b", r"\bpsoriasis"],
    "Wound Care": [r"\bwound\b", r"\bplaie", r"\burgo medical"],
    "Respiratory": [r"\brespirator", r"\bpulmonar", r"\bcopd\b", r"\basthma"],
    "Ophthalmology": [r"\bophthalmo", r"\bophtalmo", r"\beye\b", r"\bretina"],
    "Women's Health": [r"\bwomen'?s health", r"\bgyn[ée]colog", r"\bfertility"],
    "Consumer Health / OTC": [r"\bconsumer health", r"\botc\b", r"\bself[- ]?care"],
    "Medical Devices": [r"\bmedical device", r"\bdispositif m[ée]dical"],
    "Generics / Biosimilars": [r"\bgeneric", r"\bbiosimilar", r"\bg[ée]n[ée]riques?"],
}


BU_HEAD_PATTERNS = [
    r"\b(head|chief|director|vp|lead|gm|general manager) of (the )?([A-Z][a-z]+ ?){1,3}(bu|business unit|franchise|division)\b",
    r"\b(bu|business unit|franchise) (head|director|lead|manager)\b",
    r"\bhead of ([A-Z][a-zA-Z&\- /]+?)(franchise|business)?\b",
    r"\bgeneral manager.{0,30}(oncology|diabetes|rare|vaccines|neuro|cardio|dermato|obesity|immunology|respiratory)\b",
]


@dataclass
class RoleAnalysis:
    seniority: str = "Unknown"       # Top / VP / Head-Director / Senior / Manager / IC / Junior
    categories: list[str] = field(default_factory=list)
    therapeutic_areas: list[str] = field(default_factory=list)
    is_c_level: bool = False
    is_bu_head: bool = False
    manager_of_managers_flag: bool = False   # heuristic only — to validate on the field
    priority_score: int = 0                  # 0-100, higher = more interesting for muchbetter.ai
    notes: str = ""


def _match_any(patterns: list[str], text: str) -> bool:
    return any(re.search(p, text, re.IGNORECASE) for p in patterns)


def _match_all_labels(pat_dict: dict[str, list[str]], text: str) -> list[str]:
    return [k for k, pats in pat_dict.items() if _match_any(pats, text)]


def classify(title: str | None) -> RoleAnalysis:
    """Classify a single job title string."""
    r = RoleAnalysis()
    if not title or not title.strip():
        return r

    t = title.strip()
    tl = t.lower()

    # Junior short-circuit: exclude interns/assistants from priority
    if _match_any(SENIORITY_JUNIOR, tl):
        r.seniority = "Junior"
        r.notes = "Filtered as junior/intern."
        return r

    # Seniority ladder (first match wins, top-down)
    if _match_any(SENIORITY_TOP, tl):
        r.seniority = "Top (C-Level/GM)"
        r.is_c_level = True
    elif _match_any(SENIORITY_VP, tl):
        r.seniority = "VP"
    elif _match_any(SENIORITY_SENIOR, tl):
        r.seniority = "Senior Director/Manager"
    elif _match_any(SENIORITY_HEAD, tl):
        r.seniority = "Head / Director"
    elif _match_any(SENIORITY_MANAGER, tl):
        r.seniority = "Manager"
    else:
        r.seniority = "IC / Unknown"

    # Manager-of-managers heuristic: VP+ or Senior Director+ or "Head of" at org-wide function
    if r.seniority in ("Top (C-Level/GM)", "VP", "Senior Director/Manager"):
        r.manager_of_managers_flag = True
    elif r.seniority == "Head / Director" and re.search(r"\b(global|group|worldwide|europe|emea)\b", tl):
        r.manager_of_managers_flag = True

    # Categories (multi-label)
    r.categories = _match_all_labels(CATEGORIES, tl)

    # Disambiguate CMO: if both "Medical Affairs" and "Marketing / Brand" → keep Medical only if context suggests medical
    if "Medical Affairs" in r.categories and "Marketing / Brand" in r.categories:
        if re.search(r"\bmedical\b", tl):
            r.categories.remove("Marketing / Brand")
        elif re.search(r"\bmarketing\b", tl) and not re.search(r"\bmedical\b", tl):
            r.categories.remove("Medical Affairs")

    # Therapeutic areas
    r.therapeutic_areas = _match_all_labels(THERAPEUTIC_AREAS, tl)

    # BU head heuristic: any match of BU_HEAD_PATTERNS OR (Head/VP/Director seniority AND therapeutic area present)
    if _match_any(BU_HEAD_PATTERNS, tl):
        r.is_bu_head = True
    elif r.therapeutic_areas and r.seniority in ("Top (C-Level/GM)", "VP", "Head / Director", "Senior Director/Manager"):
        r.is_bu_head = True

    # Priority score for muchbetter.ai ICP
    score = 0
    if r.is_c_level:
        score += 40
    if "Digital / Transformation" in r.categories:
        score += 30
    if "Data / AI" in r.categories:
        score += 25
    if "IT / IS" in r.categories:
        score += 15
    if "Commercial Excellence" in r.categories:
        score += 20
    if "Medical Affairs" in r.categories:
        score += 10
    if "Market Access" in r.categories:
        score += 10
    if r.is_bu_head:
        score += 15
    if r.seniority == "VP":
        score += 15
    elif r.seniority == "Head / Director":
        score += 10
    elif r.seniority == "Senior Director/Manager":
        score += 5
    elif r.seniority == "Manager":
        score += 2
    r.priority_score = min(score, 100)

    return r


if __name__ == "__main__":
    # Smoke tests
    samples = [
        "Chief Digital Officer",
        "Head of Digital Transformation Europe",
        "VP Oncology, Global",
        "Senior Director, Market Access France",
        "Medical Science Liaison Intern",
        "DG France",
        "Directeur Général Adjoint",
        "CIO EMEA",
        "Head of BU Obésité",
        "Marketing Manager",
        "Chief Medical Officer",
        "Sales Force Effectiveness Lead",
    ]
    for s in samples:
        a = classify(s)
        print(f"{s!r:55s} → {a.seniority:25s} | score={a.priority_score:3d} | "
              f"cat={a.categories} | TA={a.therapeutic_areas} | "
              f"c-level={a.is_c_level} | bu={a.is_bu_head} | mom={a.manager_of_managers_flag}")
