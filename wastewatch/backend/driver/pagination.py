"""
backend/driver/pagination.py
----------------------------
Dedicated pagination classes for driver & sanitation team datasets.
"""
from wastewatch.pagination import StandardResultsSetPagination


class SanitationTeamPagination(StandardResultsSetPagination):
    """
    Dedicated server-side pagination for Sanitation Teams.
    Enforces a strict default page size of 5 teams.
    Supports unpaginated retrieval when explicitly requested (?all=true / ?paginate=false)
    for authorized views with allow_unpaginated = True.
    """
    page_size = 5
    page_size_query_param = 'page_size'
    max_page_size = 50
