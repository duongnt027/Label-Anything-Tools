ERROR_TAGS = {"Thiếu box", "Thừa box", "Sai Caption"}


def derive_image_status(tags: list[str]) -> str:
    if "Accept All" in tags:
        return "Accepted"
    if any(t in ERROR_TAGS or (t not in ("Accept S1", "Accept All") and t) for t in tags):
        for t in tags:
            if t in ERROR_TAGS:
                return "Rejected"
    if tags:
        return "Rejected" if any(t for t in tags if t not in ("Accept S1",)) else "Unseen"
    return "Unseen"


def sync_box_status_from_tags(tags: list[str], current: str) -> str:
    from app.models import BoxStatus

    if tags:
        return BoxStatus.Rejected.value
    if current == BoxStatus.Rejected.value:
        return BoxStatus.Unseen.value
    return current
