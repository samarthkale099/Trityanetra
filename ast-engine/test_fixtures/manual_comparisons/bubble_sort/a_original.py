def bubble_sort(items):
    size = len(items)
    working = items
    for i in range(size):
        for j in range(0, size - i - 1):
            if working[j] > working[j + 1]:
                working[j], working[j + 1] = working[j + 1], working[j]
    return working
